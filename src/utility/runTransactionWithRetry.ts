import { prisma } from "../../lib/prisma";



export async function runTransactionWithRetry<T>(
  fn: (tx: Parameters<typeof prisma.$transaction>[0] extends (tx: infer U) => any ? U : never) => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await prisma.$transaction(fn, { timeout: 15000, maxWait: 5000 });
    } catch (error: any) {
      const isWriteConflict = error?.code === "P2034" || /write conflict/i.test(error?.message ?? "");
      if (isWriteConflict && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 50 * attempt)); // small backoff before retry
        continue;
      }
      throw error;
    }
  }
  throw new Error("Transaction retry attempts exhausted");
}