import express from 'express'
import { createCategory, getCategory, updateCategory, delCategory } from '../controller/category';
import { requireAuth } from '../middlerware/requireAuth';
import { checkRole } from '../middlerware/checkRole';
import { createProd, delProd, getProduct, getSingleProd, updateProdStatus, updateProduct, uploadProductImage, generateProductDescription } from '../controller/product';
import { createCartItem, delCartItem, getCartItem, updateCartItem } from '../controller/cartItem';
import { createOrder, getOrder, getOrderById, updateOrder } from '../controller/order';
import { getBillingInfo, saveBillingInfo } from '../controller/billing';

export const category = express.Router();
export const product = express.Router();
export const cartItem = express.Router();
export const order = express.Router();
export const billing = express.Router();

category.post("/create", requireAuth, checkRole(["ADMIN"]), createCategory)
category.put("/update/:id", requireAuth, checkRole(["ADMIN"]), updateCategory)
category.delete("/del/:id", requireAuth, checkRole(["ADMIN"]), delCategory)
category.get("/", getCategory)

product.post("/create", requireAuth, checkRole(["ADMIN"]), createProd)
product.post("/upload-image", requireAuth, checkRole(["ADMIN"]), uploadProductImage)
product.post("/generate-description", requireAuth, checkRole(["ADMIN"]), generateProductDescription)
product.put("/update/:id", requireAuth, checkRole(["ADMIN"]), updateProduct)
product.get("/", getProduct)
product.get("/:id", getSingleProd)
product.delete("/del/:id", requireAuth, checkRole(["ADMIN"]), delProd)
product.put("/updateStatus/:id", requireAuth, checkRole(["ADMIN"]), updateProdStatus)

cartItem.post("/create", requireAuth, checkRole(["ADMIN", "APP_USER"]), createCartItem)
cartItem.get("/", requireAuth, checkRole(["ADMIN", "APP_USER"]), getCartItem)
cartItem.put("/:id", requireAuth, checkRole(["ADMIN", "APP_USER"]), updateCartItem)
cartItem.delete("/del", requireAuth, checkRole(["ADMIN", "APP_USER"]), delCartItem)

order.post("/create", requireAuth, checkRole(["ADMIN", "APP_USER"]), createOrder)
order.get("/", requireAuth, checkRole(["ADMIN", "APP_USER"]), getOrder)
order.get("/:id", requireAuth, checkRole(["ADMIN", "APP_USER"]), getOrderById)
order.put("/:id/status", requireAuth, checkRole(["ADMIN"]), updateOrder)

billing.get("/", requireAuth, checkRole(["ADMIN", "APP_USER"]), getBillingInfo)
billing.put("/", requireAuth, checkRole(["ADMIN", "APP_USER"]), saveBillingInfo)
