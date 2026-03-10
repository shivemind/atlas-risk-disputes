import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import { createHandler } from "@/lib/handler";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { emitDomainEvent } from "@/lib/events";

function serializeRiskRuleset(r: {
  id: string;
  merchantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    merchant_id: r.merchantId,
    name: r.name,
    description: r.description,
    is_active: r.isActive,
    version: r.version,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const ruleset = await prisma.riskRuleset.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!ruleset) {
      throw new NotFoundError("RULESET_NOT_FOUND", "Risk ruleset not found.");
    }
    return NextResponse.json({ risk_ruleset: serializeRiskRuleset(ruleset) });
  },
});

const updateRulesetSchema = z.object({
  description: z.string().max(2000).optional(),
  is_active: z.boolean().optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updateRulesetSchema,
  handler: async (ctx) => {
    const ruleset = await prisma.$transaction(async (tx) => {
      const existing = await tx.riskRuleset.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("RULESET_NOT_FOUND", "Risk ruleset not found.");
      }

      const data: Prisma.RiskRulesetUpdateInput = {};
      if (ctx.body.description !== undefined) data.description = ctx.body.description;
      if (ctx.body.is_active !== undefined) {
        data.isActive = ctx.body.is_active;
        data.version = { increment: 1 };
      }

      const updated = await tx.riskRuleset.update({
        where: { id: existing.id },
        data,
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "risk_ruleset.updated",
        entityType: "RiskRuleset",
        entityId: updated.id,
        payload: serializeRiskRuleset(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({ risk_ruleset: serializeRiskRuleset(ruleset) });
  },
});

export const DELETE = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.riskRuleset.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("RULESET_NOT_FOUND", "Risk ruleset not found.");
      }

      await tx.riskRuleset.delete({ where: { id: existing.id } });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "risk_ruleset.deleted",
        entityType: "RiskRuleset",
        entityId: existing.id,
        payload: serializeRiskRuleset(existing) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });
    });

    return NextResponse.json({ deleted: true, id: ctx.params.id });
  },
});
