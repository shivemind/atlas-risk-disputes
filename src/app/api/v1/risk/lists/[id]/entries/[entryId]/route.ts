import { NextResponse } from "next/server";

import { createHandler } from "@/lib/handler";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { emitDomainEvent } from "@/lib/events";

function serializeRiskListEntry(e: {
  id: string;
  listId: string;
  value: string;
  valueType: string;
  reason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: e.id,
    list_id: e.listId,
    value: e.value,
    value_type: e.valueType,
    reason: e.reason,
    expires_at: e.expiresAt?.toISOString() ?? null,
    created_at: e.createdAt.toISOString(),
  };
}

async function findEntryOrThrow(listId: string, entryId: string, merchantId: string) {
  const list = await prisma.riskList.findFirst({
    where: { id: listId, merchantId },
  });
  if (!list) {
    throw new NotFoundError("LIST_NOT_FOUND", "Risk list not found.");
  }
  const entry = await prisma.riskListEntry.findFirst({
    where: { id: entryId, listId: list.id },
  });
  if (!entry) {
    throw new NotFoundError("ENTRY_NOT_FOUND", "Risk list entry not found.");
  }
  return { list, entry };
}

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const { entry } = await findEntryOrThrow(ctx.params.id, ctx.params.entryId, ctx.merchantId);
    return NextResponse.json({ risk_list_entry: serializeRiskListEntry(entry) });
  },
});

export const DELETE = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    await prisma.$transaction(async (tx) => {
      const list = await tx.riskList.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!list) {
        throw new NotFoundError("LIST_NOT_FOUND", "Risk list not found.");
      }

      const existing = await tx.riskListEntry.findFirst({
        where: { id: ctx.params.entryId, listId: list.id },
      });
      if (!existing) {
        throw new NotFoundError("ENTRY_NOT_FOUND", "Risk list entry not found.");
      }

      await tx.riskListEntry.delete({ where: { id: existing.id } });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "risk_list_entry.deleted",
        entityType: "RiskListEntry",
        entityId: existing.id,
        payload: {
          ...serializeRiskListEntry(existing),
          risk_list_id: list.id,
        } as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });
    });

    return NextResponse.json({ deleted: true, id: ctx.params.entryId });
  },
});
