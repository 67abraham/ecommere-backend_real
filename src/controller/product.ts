import type { Request, Response } from "express";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { broadcastMessage } from "../utility/websock";
import { OrderStatus, ProductStatus } from "../../generated/prisma/enums";
import { auth } from "../../lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { createHash, createHmac, randomUUID } from "crypto";

const isObjectId = (value: unknown): value is string =>
    typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

const cleanStringList = (value: unknown, maxItems: number, maxLength: number) =>
    Array.isArray(value)
        ? [...new Set(value
            .filter((item): item is string => typeof item === "string")
            .map(item => item.trim())
            .filter(Boolean)
            .map(item => item.slice(0, maxLength))
        )].slice(0, maxItems)
        : [];

const cleanColors = (value: unknown) =>
    Array.isArray(value)
        ? value
            .filter((item): item is { name?: unknown; hex?: unknown } => !!item && typeof item === "object")
            .map(item => ({
                name: typeof item.name === "string" ? item.name.trim().slice(0, 50) : "",
                hex: typeof item.hex === "string" ? item.hex.trim() : "",
            }))
            .filter(item => item.name && /^#[0-9a-f]{6}$/i.test(item.hex))
            .slice(0, 20)
        : [];

const cleanImages = (value: unknown) =>
    Array.isArray(value)
        ? [...new Set(value
            .filter((item): item is string => typeof item === "string")
            .map(item => item.trim())
            .filter(item => /^https?:\/\/\S+$/i.test(item))
        )].slice(0, 4)
        : [];

const parseProductInput = (body: any) => {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
    const categoryId = typeof body.categoryId === "string" ? body.categoryId.trim() : "";
    const price = Number(body.price);
    const minimumOrder = Number(body.minimumOrder);
    const productLocation = typeof body.productLocation === "string" ? body.productLocation.trim().slice(0, 200) : "";
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 10000) : "";
    const brand = typeof body.brand === "string" ? body.brand.trim().slice(0, 100) : null;
    const tags = cleanStringList(body.tags, 30, 50);
    const sizes = cleanStringList(body.sizes, 30, 50);
    const colors = cleanColors(body.colors);
    const imageUrl = cleanImages(body.imageUrl);
    return { name, categoryId, price, minimumOrder, productLocation, description, brand: brand || null, tags, sizes, colors, imageUrl };
};

export const createProd = async (req: Request, res: Response) => {
    try {
        const input = parseProductInput(req.body);
        if (!input.name || !isObjectId(input.categoryId)) {
            return res.status(400).json({ message: "Product name and a valid category are required" });
        }
        if (!Number.isFinite(input.price) || input.price <= 0 || input.price > 1_000_000_000) {
            return res.status(400).json({ message: "Price must be greater than 0 and within the allowed range" });
        }
        if (!Number.isInteger(input.minimumOrder) || input.minimumOrder < 1 || input.minimumOrder > 1_000_000) {
            return res.status(400).json({ message: "Minimum order must be a whole number between 1 and 1,000,000" });
        }
        if (!input.productLocation) return res.status(400).json({ message: "Product location is required" });
        if (input.imageUrl.length === 0) return res.status(400).json({ message: "At least one valid product image URL is required" });

        const category = await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
        if (!category) return res.status(404).json({ message: "Category not found" });

        const created = await prisma.product.create({
            data: {
                ...input,
                status: req.body.status === "NOT_AVAILABLE" ? ProductStatus.NOT_AVAILABLE : ProductStatus.AVAILABLE,
            },
        });

        logger.info(`Product Create: ${created.name}`);
        broadcastMessage({ event: "create:product", data: { id: created.id, status: created.status } });
        return res.status(201).json(created);
    } catch (error) {
        logger.error(`Error creating product: ${error}`);
        return res.status(500).json({ message: "Unable to create product" });
    }
};

export const updateProduct = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const input = parseProductInput(req.body);
        if (!isObjectId(id)) return res.status(400).json({ message: "Invalid product id" });
        if (!input.name || !isObjectId(input.categoryId)) {
            return res.status(400).json({ message: "Product name and a valid category are required" });
        }
        if (!Number.isFinite(input.price) || input.price <= 0 || input.price > 1_000_000_000) {
            return res.status(400).json({ message: "Price must be greater than 0 and within the allowed range" });
        }
        if (!Number.isInteger(input.minimumOrder) || input.minimumOrder < 1 || input.minimumOrder > 1_000_000) {
            return res.status(400).json({ message: "Minimum order must be a whole number between 1 and 1,000,000" });
        }
        if (!input.productLocation) return res.status(400).json({ message: "Product location is required" });
        if (input.imageUrl.length === 0) return res.status(400).json({ message: "At least one valid product image URL is required" });

        const [existing, category] = await Promise.all([
            prisma.product.findUnique({ where: { id }, select: { id: true } }),
            prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } }),
        ]);
        if (!existing) return res.status(404).json({ message: "Product not found" });
        if (!category) return res.status(404).json({ message: "Category not found" });

        const updated = await prisma.product.update({ where: { id }, data: input });
        logger.info(`Update Product: ${updated.name}`);
        broadcastMessage({ event: "product:updated", data: { id: updated.id, status: updated.status } });
        return res.status(200).json(updated);
    } catch (error) {
        logger.error(`Error updating product: ${error}`);
        return res.status(500).json({ message: "Unable to update product" });
    }
};

export const updateProdStatus = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const status = (typeof req.body?.status === "string" ? req.body.status : req.query.status) as ProductStatus;
        if (!isObjectId(id)) return res.status(400).json({ message: "Invalid product id" });
        if (!Object.values(ProductStatus).includes(status)) return res.status(400).json({ message: "Invalid product status" });

        const existing = await prisma.product.findUnique({ where: { id }, select: { id: true, status: true } });
        if (!existing) return res.status(404).json({ message: "Product not found" });
        if (existing.status === status) return res.status(200).json(existing);

        const updated = await prisma.product.update({ where: { id }, data: { status } });
        broadcastMessage({ event: "product:status-updated", data: { id: updated.id, status: updated.status } });
        return res.status(200).json(updated);
    } catch (error) {
        logger.error(`Error updating product status: ${error}`);
        return res.status(500).json({ message: "Unable to update product status" });
    }
};

export const delProd =  async(req:Request, res:Response)=>{
    try {
        const {id}= req.params as {id:string}
        if (!isObjectId(id)) return res.status(400).json({ message: "Invalid product id" })

        const existing = await prisma.product.findUnique({ where: { id }, select: { id: true } })
        if (!existing) return res.status(404).json({ message: "Product not found" })

        // Products can be referenced by historical orders, so archive them instead of
        // physically deleting the record and breaking order history.
        const archived = await prisma.product.update({
            where: { id },
            data: { status: ProductStatus.NOT_AVAILABLE }
        })

        broadcastMessage({ event: "product:status-updated", data: { id: archived.id, status: archived.status } })
        logger.info(`Archived Product: ${archived.name}`)
        return res.status(200).json({ message: "Product archived successfully", product: archived })

    } catch (error) {
        logger.error(`Error deleting product: ${error}`)
        return res.status(500).json({ message: "Unable to delete product" })
    }
}

export const getProduct = async(req:Request, res:Response)=>{
    try {
        const session = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers)
        })

        const rawPage = Number(req.query.page);
        const rawLimit = Number(req.query.limit);
        const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100_000) : 1;
        const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10;
        const skip = (page - 1) * limit;
        const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
        const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId.trim() : undefined;
        if (categoryId && !isObjectId(categoryId)) return res.status(400).json({ message: "Invalid category id" });
        const available = session?.user.role === "ADMIN" ? undefined : ProductStatus.AVAILABLE

        const where = {
            status: ProductStatus.AVAILABLE,
            ...(categoryId ? { categoryId } : {}),
            ...(search ? {
                OR: [
                    { name: { contains: search, mode: "insensitive" as const } },
                    { brand: { contains: search, mode: "insensitive" as const } },
                    { productLocation: { contains: search, mode: "insensitive" as const } },
                    { tags: { has: search } },
                ]
            } : {})
        }

        const [getAllProd, totalProduct] = await Promise.all([
            prisma.product.findMany({
                skip,
                take: limit,
                orderBy: { name: "asc" },
                where,
                include: { category: true }
            }),
            prisma.product.count({ where })
        ])

        const totalPage = Math.ceil(totalProduct / limit)

        res.status(200).json({
            getAllProd,
            totalPage,
            skip,
            hasNextPage: page < totalPage,
            hasPrevPage: page > 1
        })
    } catch (error) {
        logger.error(`Error: ${error}`)
        res.status(500).json({ message: "Unable to fetch products" })
    }
}

export const getSingleProd = async(req:Request, res:Response)=>{
    try {

        const {id}=req.params as {id:string}
        if (!isObjectId(id)) return res.status(400).json({ message: "Invalid product id" })

        const getProd = await prisma.product.findFirst({
            where:{ id, status: ProductStatus.AVAILABLE },
            include:{
                category: true,
                comment:{
                    include:{
                        user:{
                            select:{name:true, image:true,}
                        }
                    }
                }
            }
        })

        if (!getProd) return res.status(404).json({ message: "Product not found" })
        logger.info("Get Single Prod Detail")
        return res.status(200).json(getProd)
        
    } catch (error) {
       logger.error(`Error getting product detail: ${error}`)
       return res.status(500).json({ message: "Unable to fetch product" })
    }
}

const awsSignature = (secret: string, date: string, region: string, service: string) => {
    const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value).digest();
    const kDate = hmac(`AWS4${secret}`, date);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    return hmac(kService, "aws4_request");
};

export const uploadProductImage = async (req: Request, res: Response) => {
    try {
        const { fileName, data } = req.body;
        const accessKey = process.env.R2_ACCESS_KEY_ID;
        const secretKey = process.env.R2_SECRET_ACCESS_KEY;
        const endpoint = process.env.R2_ENDPOINT || process.env.S3_API_KEY;
        const bucket = process.env.R2_BUCKET_NAME || process.env.BUCKET_NAME;
        const publicBase = process.env.R2_PUBLIC_URL;

        if (!accessKey || !secretKey || !endpoint || !bucket || !publicBase) {
            return res.status(503).json({ message: "Cloudflare R2 upload is not configured on the server" });
        }
        if (typeof data !== "string") return res.status(400).json({ message: "Invalid image payload" });
        const match = data.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i);
        if (!match) return res.status(400).json({ message: "Only JPEG, PNG, WebP and GIF images are allowed" });

        const declaredType = match[1]?.toLowerCase();
        const body = Buffer.from(match[2]!, "base64");
        if (!body.length || body.length > 5 * 1024 * 1024) {
            return res.status(400).json({ message: "Image must be between 1 byte and 5MB" });
        }

        const detectedType =
            body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? "image/jpeg" :
            body.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) ? "image/png" :
            body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp" :
            body.subarray(0, 4).toString("ascii") === "GIF8" ? "image/gif" : "";
        if (!detectedType || detectedType !== declaredType) return res.status(400).json({ message: "Image content does not match its declared type" });

        const safeName = String(fileName || "image").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100);
        const key = `products/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;
        const endpointUrl = new URL(endpoint);
        const host = endpointUrl.host;
        const region = "auto";
        const service = "s3";
        const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
        const date = amzDate.slice(0, 8);
        const canonicalUri = `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
        const payloadHash = createHash("sha256").update(body).digest("hex");
        const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
        const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
        const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
        const credentialScope = `${date}/${region}/${service}/aws4_request`;
        const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
        const signingKey = awsSignature(secretKey, date, region, service);
        const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
        const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

        const response = await fetch(`${endpointUrl.origin}${canonicalUri}`, {
            method: "PUT",
            headers: {
                Host: host,
                "Content-Type": detectedType,
                "x-amz-content-sha256": payloadHash,
                "x-amz-date": amzDate,
                Authorization: authorization,
            },
            body,
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
            const errorBody = await response.text();
            logger.error(`R2 upload failed: ${response.status} ${errorBody}`);
            return res.status(502).json({ message: "Unable to upload image to Cloudflare R2" });
        }

        return res.status(201).json({ url: `${publicBase.replace(/\/$/, "")}/${key}` });
    } catch (error) {
        logger.error(`Error uploading product image: ${error}`);
        return res.status(500).json({ message: "Unable to upload product image" });
    }
};

export const generateProductDescription = async (req: Request, res: Response) => {
    try {
        const apiKey = process.env.OPEN_ROUTER_API_KEY;
        if (!apiKey) return res.status(503).json({ message: "OpenRouter is not configured on the server" });

        const { name, brand, category, specifications, imageUrl } = req.body;
        if (!name) return res.status(400).json({ message: "Product name is required" });

        const content: unknown[] = [{
            type: "text",
            text: `Write a concise, professional e-commerce product description in under 100 words. Do not invent specifications. Product name: ${name}. Brand: ${brand || "Not provided"}. Category: ${category || "Not provided"}. Specifications: ${specifications || "Not provided"}.`,
        }];
        if (typeof imageUrl === "string" && imageUrl.startsWith("http")) {
            content.push({ type: "image_url", image_url: { url: imageUrl } });
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": process.env.CLIENT_ROUTE || "http://localhost:5173",
                "X-Title": "Square Trade Sourcing",
            },
            body: JSON.stringify({
                model: process.env.OPEN_ROUTER_MODEL || "openrouter/free",
                messages: [{ role: "user", content }],
                max_tokens: 180,
            }),
            signal: AbortSignal.timeout(30_000),
        });
        const payload = await response.json() as any;
        if (!response.ok) {
            logger.error(`OpenRouter failed: ${JSON.stringify(payload)}`);
            return res.status(502).json({ message: "Unable to generate product description" });
        }
        const description = payload?.choices?.[0]?.message?.content?.trim();
        if (!description) return res.status(502).json({ message: "AI returned an empty description" });
        return res.status(200).json({ description });
    } catch (error) {
        logger.error(`Error generating description: ${error}`);
        return res.status(500).json({ message: "Unable to generate product description" });
    }
};
