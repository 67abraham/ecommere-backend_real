import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { broadcastMessage } from "../utility/websock";

const isObjectId = (value: unknown): value is string => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

export const createCategory = async(req:Request, res:Response)=>{

    try {
        const name = typeof req.body.name === "string" ? req.body.name.trim() : ""
        if (!name) return res.status(400).json({ message: "Category name is required" })
        const existingName = await prisma.category.findUnique({where:{name}})
        if(existingName) return res.status(409).json({message: "Category name already exists"});
    
        const tag = name.toLowerCase();
    
        const saveName = await prisma.category.create({
            data:{
                name,
                tag
            }
        })
        logger.info(`Category Name: ${saveName.name}`)
        broadcastMessage({ event: "category:created", data: { id: saveName.id } })
        return res.status(201).json(saveName)
        
    } catch (error) {
        logger.error(`Error creating category: ${error}`)
        if ((error as { code?: string })?.code === "P2002") return res.status(409).json({ message: "Category name already exists" });
        return res.status(500).json({ message: "Unable to create category" })
    }


}

export const updateCategory =async(req:Request, res:Response)=>{
    try {
        const {id}= req.params as {id:string}
        if (!isObjectId(id)) return res.status(400).json({ message: "Invalid category id" });
        const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
        if (!name) return res.status(400).json({ message: "Category name is required" });

        const existingName = await prisma.category.findUnique({where:{name}})
        if(existingName && existingName.id !== id) return res.status(409).json({message: "Category name already exists"});

        const updateCate = await prisma.category.update({
            where: {id},
            data:{name, tag: name.toLowerCase()}
        });

        logger.info(`Update-Category Name: ${updateCate.name}`)
        broadcastMessage({ event: "category:updated", data: { id: updateCate.id } })
        return res.status(200).json(updateCate);

    } catch (error) {
        logger.error(`Error updating category: ${error}`)
        const code = (error as { code?: string })?.code;
        if (code === "P2002") return res.status(409).json({ message: "Category name already exists" });
        if (code === "P2025") return res.status(404).json({ message: "Category not found" });
        return res.status(500).json({ message: "Unable to update category" })
    }
}

export const delCategory = async (req:Request, res:Response)=>{
    try {
        const {id} = req.params as {id:string}
        if (!isObjectId(id)) return res.status(400).json({ message: "Invalid category id" })
        
            logger.info(id)
        const delCa = await prisma.category.delete({
            where: {id}
        })

        logger.info("DELETE CATEGORY")
        broadcastMessage({ event: "category:deleted", data: { id } })
        return res.status(200).json({message: "Delete Successful"})
    } catch (error) {
        logger.error(`Error deleting category: ${error}`)
        const code = (error as { code?: string })?.code
        if (code === "P2025") return res.status(404).json({ message: "Category not found" })
        if (code === "P2014") return res.status(409).json({ message: "Category cannot be deleted while products are assigned to it" })
        return res.status(500).json({ message: "Unable to delete category" })
    }
}

//get cate

export const getCategory = async(req:Request, res:Response)=>{
    try {

        const getCat = await prisma.category.findMany({ orderBy: { name: "asc" } });

        logger.info(`Get-Category Name`)

       res.status(200).json(getCat)
        
    } catch (error) {
        logger.error(`Error getting categories: ${error}`)
        return res.status(500).json({ message: "Unable to fetch categories" })
    }
}