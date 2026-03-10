import { NextResponse } from "next/server";

import { createHandler } from "@/lib/handler";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

function serializeRiskSignal(s: {
  id: string;
  merchantId: string;
  entityType: string;
  entityId: string;
  signalType: string;
  severity: string;
  details: unknown;
  createdAt: Date;
}) {
  return {
    id: s.id,
    merchant_id: s.merchantId,
    entity_type: s.entityType,
    entity_id: s.entityId,
    signal_type: s.signalType,
    severity: s.severity.toLowerCase(),
    details: s.details,
    created_at: s.createdAt.toISOString(),
  };
}

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const signal = await prisma.riskSignal.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!signal) {
      throw new NotFoundError("RISK_SIGNAL_NOT_FOUND", "Risk signal not found.");
    }
    return NextResponse.json({ risk_signal: serializeRiskSignal(signal) });
  },
});
