import type { Request, Response } from "express";
import { randomBytes } from "crypto";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { broadcastMessage } from "../utility/websock";
import { sendEmail } from "../../lib/sendEmail";
import { OrderStatus } from "../../generated/prisma/enums";
import { runTransactionWithRetry } from "../utility/runTransactionWithRetry";

const uid = (req: Request) => (req as any).user.id as string;
const role = (req: Request) => (req as any).user.role as string;
const SHIPPING_METHODS = ["Ship", "Flight"] as const;
const generateCode = () => `ORD-${randomBytes(4).toString("hex").toUpperCase()}`;

const orderInclude = {
  user: { select: { name: true, email: true } },
  item: {
    include: {
      product: { select: { id: true, name: true, imageUrl: true, price: true, productLocation: true } },
    },
  },
} as const;
const MAX_CART_ITEMS_PER_ORDER = 100;

export const createOrder = async (req: Request, res: Response) => {
  try {
    const { cartID, shippingMethod } = req.body;
    const rawCartIds: unknown[] = Array.isArray(cartID) ? cartID : [];
    const cartId: string[] = [...new Set(rawCartIds
      .filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id: string) => id.trim()))];
    const shippingMeth = typeof shippingMethod === "string" ? shippingMethod.trim() : "";

    if (cartId.length === 0) return res.status(400).json({ message: "No cart items found" });
    if (cartId.length > MAX_CART_ITEMS_PER_ORDER) {
      return res.status(400).json({ message: `A single order can include at most ${MAX_CART_ITEMS_PER_ORDER} items` });
    }
    if (!SHIPPING_METHODS.includes(shippingMeth as (typeof SHIPPING_METHODS)[number])) {
      return res.status(400).json({ message: "Shipping method must be Ship or Flight" });
    }

    const user = await prisma.user.findUnique({ where: { id: uid(req) }, select: { id: true, email: true } });
    if (!user) return res.status(401).json({ message: "User account was not found" });

    const billing = await prisma.billingInfo.findUnique({ where: { userId: user.id } });
    if (!billing || !billing.fullName.trim() || !billing.currentAddress.trim() || !billing.city.trim() || !billing.contact.trim()) {
      return res.status(400).json({ message: "Please save your delivery information before placing an order" });
    }

    const created = await runTransactionWithRetry(async (tx) => {
      const items = await tx.cartItem.findMany({
        where: { id: { in: cartId }, userId: user.id, ordered: false },
        include: { product: true },
      });

      if (items.length !== cartId.length) throw new Error("CART_ITEMS_INVALID");
      if (items.some(item => item.product.status !== "AVAILABLE")) throw new Error("PRODUCT_UNAVAILABLE");
      if (items.some(item => !Number.isInteger(item.quantity) || item.quantity < item.product.minimumOrder)) {
        throw new Error("MINIMUM_ORDER_NOT_MET");
      }

      const totalAmount = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) throw new Error("INVALID_ORDER_TOTAL");

      const claimed = await tx.cartItem.updateMany({
        where: { id: { in: cartId }, userId: user.id, ordered: false },
        data: { ordered: true },
      });
      if (claimed.count !== cartId.length) throw new Error("CART_ALREADY_ORDERED");

      const bulkResult: any = await tx.$runCommandRaw({
        update: "CartItem",
        updates: items.map(item => ({
          q: { _id: { $oid: item.id } },
          u: { $set: { unitPrice: item.product.price } },
        })),
        ordered: false,
      });
      if (bulkResult?.writeErrors?.length) throw new Error("UNIT_PRICE_SNAPSHOT_FAILED");

      return tx.order.create({
        data: {
          orderNumber: generateCode(),
          totalAmount,
          userId: user.id,
          shippingMethod: shippingMeth,
          item: { connect: items.map(item => ({ id: item.id })) },
        },
        include: orderInclude,
      });
    });

    try {
      broadcastMessage({ event: "order:created", data: { orderId: created.id } });
    } catch (broadcastError) {
      logger.error(broadcastError, "Failed to broadcast order:created");
    }

    if (user.email) {
      void sendEmail({
        to: user.email,
        subject: `Order ${created.orderNumber} received`,
        message: `Your order ${created.orderNumber} was created successfully. Total: ${created.totalAmount.toFixed(2)}. Current status: ${created.status}.`,
      }).catch(error => logger.error(error, "Order email failed"));
    }

    return res.status(201).json({ message: "Order created", order: created });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "CART_ITEMS_INVALID") return res.status(400).json({ message: "One or more cart items are invalid" });
    if (code === "PRODUCT_UNAVAILABLE") return res.status(400).json({ message: "One or more products are unavailable" });
    if (code === "MINIMUM_ORDER_NOT_MET") return res.status(400).json({ message: "One or more items do not meet the minimum order quantity" });
    if (code === "INVALID_ORDER_TOTAL") return res.status(400).json({ message: "Unable to calculate a valid order total" });
    if (code === "CART_ALREADY_ORDERED") return res.status(409).json({ message: "Your cart changed while placing the order. Please review it and try again." });
    if (code === "UNIT_PRICE_SNAPSHOT_FAILED") return res.status(500).json({ message: "Unable to finalize order pricing" });
    logger.error(error, "Error creating order");
    return res.status(500).json({ message: "Unable to create order" });
  }
};

export const getOrderById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    if (!id || !/^[a-f\d]{24}$/i.test(id)) return res.status(400).json({ message: "Invalid order id" });
    const where = role(req) === "ADMIN" ? { id } : { id, userId: uid(req) };
    const order = await prisma.order.findFirst({ where, include: orderInclude });
    if (!order) return res.status(404).json({ message: "Order not found" });
    return res.status(200).json({ order });
  } catch (error) {
    logger.error(`Error getting order details: ${error}`);
    return res.status(500).json({ message: "Unable to fetch order details" });
  }
};

export const getOrder = async (req: Request, res: Response) => {
  try {
    const rawPage = Number(req.query.page);
    const rawLimit = Number(req.query.limit);
    const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100_000) : 1;
    const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
    const skip = (page - 1) * limit;
    const where = role(req) === "ADMIN" ? {} : { userId: uid(req) };

    const [getO, totalOrder] = await Promise.all([
      prisma.order.findMany({ skip, take: limit, where, orderBy: { createAt: "desc" }, include: orderInclude }),
      prisma.order.count({ where }),
    ]);
    const totalPage = Math.ceil(totalOrder / limit);
    return res.status(200).json({ getO, totalPage, skip, hasNextPage: page < totalPage, hasPrevPage: page > 1 });
  } catch (error) {
    logger.error(`Error getting orders: ${error}`);
    return res.status(500).json({ message: "Unable to fetch orders" });
  }
};

export const updateOrder = async (req: Request, res: Response) => {
  try {
    if (role(req) !== "ADMIN") {
      return res.status(403).json({ message: "Only administrators can update order status" });
    }
    const { id } = req.params as { id: string };
    const rawStatus = typeof req.body?.status === "string" ? req.body.status : req.query.status;
    const status = rawStatus as OrderStatus;
    if (!id || !Object.values(OrderStatus).includes(status)) {
      return res.status(400).json({ message: "Invalid order status" });
    }

    const transitions: Record<OrderStatus, OrderStatus[]> = {
      PENDING: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
      PAID: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
      PREPARING: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
      SHIPPED: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
      DELIVERED: [],
      CANCELLED: [],
    };
    const allowedFromStatuses = (Object.keys(transitions) as OrderStatus[])
      .filter(from => transitions[from].includes(status));

    // Atomic compare-and-swap: the WHERE clause requires the order to still be
    // in one of the valid source statuses at write time, so two concurrent
    // requests can't both succeed off a stale read of "current status".
    const { count } = await prisma.order.updateMany({
      where: { id, status: { in: allowedFromStatuses } },
      data: { status },
    });

    if (count === 0) {
      const current = await prisma.order.findUnique({ where: { id }, select: { status: true } });
      if (!current) return res.status(404).json({ message: "Order not found" });
      return res.status(409).json({ message: `Order cannot move from ${current.status} to ${status}` });
    }

    const updated = await prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!updated) return res.status(404).json({ message: "Order not found" });

    try {
      broadcastMessage({ event: "order:updated", data: { orderId: updated.id, status: updated.status } });
    } catch (broadcastError) {
      logger.error(broadcastError, "Failed to broadcast order:updated");
    }

    if (updated.user?.email) {
      void sendEmail({
        to: updated.user.email,
        subject: `Order ${updated.orderNumber} updated`,
        message: `Your order ${updated.orderNumber} is now ${updated.status}.`,
      }).catch(error => logger.error(error, "Order status email failed"));
    }
    return res.status(200).json(updated);
  } catch (error) {
    logger.error(error, "Error updating order");
    return res.status(500).json({ message: "Unable to update order" });
  }
};
