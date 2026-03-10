import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import { createHandler } from "@/lib/handler";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { emitDomainEvent } from "@/lib/events";

function serializeRiskRule(r: {
  id: string;
  rulesetId: string;
  name: string;
  description: string | null;
  condition: unknown;
  action: string;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    ruleset_id: r.rulesetId,
    name: r.name,
    description: r.description,
    condition: r.condition,
    action: r.action.toLowerCase(),
    priority: r.priority,
    is_active: r.isActive,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

async function findRuleOrThrow(rulesetId: string, ruleId: string, merchantId: string) {
  const ruleset = await prisma.riskRuleset.findFirst({
    where: { id: rulesetId, merchantId },
  });
  if (!ruleset) {
    throw new NotFoundError("RULESET_NOT_FOUND", "Risk ruleset not found.");
  }
  const rule = await prisma.riskRule.findFirst({
    where: { id: ruleId, rulesetId: ruleset.id },
  });
  if (!rule) {
    throw new NotFoundError("RULE_NOT_FOUND", "Risk rule not found.");
  }
  return { ruleset, rule };
}

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const { rule } = await findRuleOrThrow(ctx.params.id, ctx.params.ruleId, ctx.merchantId);
    return NextResponse.json({ risk_rule: serializeRiskRule(rule) });
  },
});

const updateRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  condition: z.record(z.string(), z.unknown()).optional(),
  action: z.enum(["allow", "block", "review", "challenge"]).optional(),
  priority: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updateRuleSchema,
  handler: async (ctx) => {
    const rule = await prisma.$transaction(async (tx) => {
      const ruleset = await tx.riskRuleset.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!ruleset) {
        throw new NotFoundError("RULESET_NOT_FOUND", "Risk ruleset not found.");
      }

      const existing = await tx.riskRule.findFirst({
        where: { id: ctx.params.ruleId, rulesetId: ruleset.id },
      });
      if (!existing) {
        throw new NotFoundError("RULE_NOT_FOUND", "Risk rule not found.");
      }

      const data: Prisma.RiskRuleUpdateInput = {};
      if (ctx.body.name !== undefined) data.name = ctx.body.name;
      if (ctx.body.description !== undefined) data.description = ctx.body.description;
      if (ctx.body.condition !== undefined) {
        data.condition = ctx.body.condition as Prisma.InputJsonValue;
      }
      if (ctx.body.action !== undefined) {
        data.action = ctx.body.action.toUpperCase() as "ALLOW" | "BLOCK" | "REVIEW" | "CHALLENGE";
      }
      if (ctx.body.priority !== undefined) data.priority = ctx.body.priority;
      if (ctx.body.is_active !== undefined) data.isActive = ctx.body.is_active;

      const updated = await tx.riskRule.update({
        where: { id: existing.id },
        data,
      });

      await tx.riskRuleset.update({
        where: { id: ruleset.id },
        data: { version: { increment: 1 } },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "risk_rule.updated",
        entityType: "RiskRule",
        entityId: updated.id,
        payload: serializeRiskRule(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({ risk_rule: serializeRiskRule(rule) });
  },
});

export const DELETE = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    await prisma.$transaction(async (tx) => {
      const ruleset = await tx.riskRuleset.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!ruleset) {
        throw new NotFoundError("RULESET_NOT_FOUND", "Risk ruleset not found.");
      }

      const existing = await tx.riskRule.findFirst({
        where: { id: ctx.params.ruleId, rulesetId: ruleset.id },
      });
      if (!existing) {
        throw new NotFoundError("RULE_NOT_FOUND", "Risk rule not found.");
      }

      await tx.riskRule.delete({ where: { id: existing.id } });

      await tx.riskRuleset.update({
        where: { id: ruleset.id },
        data: { version: { increment: 1 } },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "risk_rule.deleted",
        entityType: "RiskRule",
        entityId: existing.id,
        payload: serializeRiskRule(existing) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });
    });

    return NextResponse.json({ deleted: true, id: ctx.params.ruleId });
  },
});
