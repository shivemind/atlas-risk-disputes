import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import { createHandler } from "@/lib/handler";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { emitDomainEvent } from "@/lib/events";

function serializeRiskList(l: {
  id: string;
  merchantId: string;
  name: string;
  type: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: l.id,
    merchant_id: l.merchantId,
    name: l.name,
    type: l.type.toLowerCase(),
    description: l.description,
    is_active: l.isActive,
    created_at: l.createdAt.toISOString(),
    updated_at: l.updatedAt.toISOString(),
  };
}

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const list = await prisma.riskList.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!list) {
      throw new NotFoundError("LIST_NOT_FOUND", "Risk list not found.");
    }
    return NextResponse.json({ risk_list: serializeRiskList(list) });
  },
});

const updateListSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  is_active: z.boolean().optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updateListSchema,
  handler: async (ctx) => {
    const list = await prisma.$transaction(async (tx) => {
      const existing = await tx.riskList.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("LIST_NOT_FOUND", "Risk list not found.");
      }

      const data: Prisma.RiskListUpdateInput = {};
      if (ctx.body.name !== undefined) data.name = ctx.body.name;
      if (ctx.body.description !== undefined) data.description = ctx.body.description;
      if (ctx.body.is_active !== undefined) data.isActive = ctx.body.is_active;

      const updated = await tx.riskList.update({
        where: { id: existing.id },
        data,
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "risk_list.updated",
        entityType: "RiskList",
        entityId: updated.id,
        payload: serializeRiskList(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({ risk_list: serializeRiskList(list) });
  },
});

export const DELETE = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.riskList.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("LIST_NOT_FOUND", "Risk list not found.");
      }

      await tx.riskList.delete({ where: { id: existing.id } });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "risk_list.deleted",
        entityType: "RiskList",
        entityId: existing.id,
        payload: serializeRiskList(existing) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });
    });

    return NextResponse.json({ deleted: true, id: ctx.params.id });
  },
});
