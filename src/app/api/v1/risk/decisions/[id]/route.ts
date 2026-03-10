import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import { createHandler } from "@/lib/handler";
import { NotFoundError, ConflictError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { emitDomainEvent } from "@/lib/events";

function serializeRiskDecision(d: {
  id: string;
  merchantId: string;
  entityType: string;
  entityId: string;
  outcome: string;
  riskScore: number | null;
  rulesetId: string | null;
  ruleId: string | null;
  reason: string | null;
  overriddenBy: string | null;
  overriddenAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: d.id,
    merchant_id: d.merchantId,
    entity_type: d.entityType,
    entity_id: d.entityId,
    outcome: d.outcome.toLowerCase(),
    risk_score: d.riskScore,
    ruleset_id: d.rulesetId,
    rule_id: d.ruleId,
    reason: d.reason,
    overridden_by: d.overriddenBy,
    overridden_at: d.overriddenAt?.toISOString() ?? null,
    metadata: d.metadata,
    created_at: d.createdAt.toISOString(),
    updated_at: d.updatedAt.toISOString(),
  };
}

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const decision = await prisma.riskDecision.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!decision) {
      throw new NotFoundError("DECISION_NOT_FOUND", "Risk decision not found.");
    }
    return NextResponse.json({ risk_decision: serializeRiskDecision(decision) });
  },
});

const overrideDecisionSchema = z.object({
  outcome: z.enum(["allow", "block", "review", "challenge"]),
  reason: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: overrideDecisionSchema,
  handler: async (ctx) => {
    const decision = await prisma.$transaction(async (tx) => {
      const existing = await tx.riskDecision.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("DECISION_NOT_FOUND", "Risk decision not found.");
      }
      if (existing.overriddenBy) {
        throw new ConflictError(
          "DECISION_ALREADY_OVERRIDDEN",
          "This decision has already been overridden.",
        );
      }

      const data: Prisma.RiskDecisionUpdateInput = {
        outcome: ctx.body.outcome.toUpperCase() as "ALLOW" | "BLOCK" | "REVIEW" | "CHALLENGE",
        overriddenBy: ctx.apiKey.id,
        overriddenAt: new Date(),
      };
      if (ctx.body.reason !== undefined) data.reason = ctx.body.reason;
      if (ctx.body.metadata !== undefined) {
        data.metadata = ctx.body.metadata as Prisma.InputJsonValue;
      }

      const updated = await tx.riskDecision.update({
        where: { id: existing.id },
        data,
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "risk_decision.overridden",
        entityType: "RiskDecision",
        entityId: updated.id,
        payload: serializeRiskDecision(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({ risk_decision: serializeRiskDecision(decision) });
  },
});
