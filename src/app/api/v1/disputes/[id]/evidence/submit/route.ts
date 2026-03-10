import { NextResponse } from "next/server";

import { createHandler } from "@/lib/handler";
import { NotFoundError, ConflictError, BadRequestError } from "@/lib/errors";
import { emitDomainEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { defineTransitions } from "@/lib/state-machine";

type DisputeStatus =
  | "NEEDS_RESPONSE"
  | "UNDER_REVIEW"
  | "WON"
  | "LOST"
  | "ACCEPTED"
  | "EXPIRED";

const disputeMachine = defineTransitions<DisputeStatus>({
  NEEDS_RESPONSE: ["UNDER_REVIEW", "ACCEPTED", "EXPIRED"],
  UNDER_REVIEW: ["WON", "LOST"],
});

function serializeEvidence(e: {
  id: string;
  disputeId: string;
  type: string;
  fileName: string | null;
  fileSize: number | null;
  description: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: e.id,
    dispute_id: e.disputeId,
    type: e.type.toLowerCase(),
    file_name: e.fileName,
    file_size: e.fileSize,
    description: e.description,
    submitted_at: e.submittedAt?.toISOString() ?? null,
    created_at: e.createdAt.toISOString(),
    updated_at: e.updatedAt.toISOString(),
  };
}

function serializeDispute(d: {
  id: string;
  merchantId: string;
  paymentIntentId: string;
  status: string;
  reason: string;
  amount: number;
  currency: string;
  dueBy: Date | null;
  closedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: d.id,
    merchant_id: d.merchantId,
    payment_intent_id: d.paymentIntentId,
    status: d.status.toLowerCase(),
    reason: d.reason.toLowerCase(),
    amount: d.amount,
    currency: d.currency,
    due_by: d.dueBy?.toISOString() ?? null,
    closed_at: d.closedAt?.toISOString() ?? null,
    metadata: d.metadata,
    created_at: d.createdAt.toISOString(),
    updated_at: d.updatedAt.toISOString(),
  };
}

export const POST = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const result = await prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!dispute) {
        throw new NotFoundError("DISPUTE_NOT_FOUND", "Dispute not found.");
      }
      if (disputeMachine.isTerminal(dispute.status as DisputeStatus)) {
        throw new ConflictError(
          "DISPUTE_CLOSED",
          "Cannot submit evidence for a closed dispute.",
        );
      }

      const unsubmitted = await tx.disputeEvidence.findMany({
        where: { disputeId: dispute.id, submittedAt: null },
      });
      if (unsubmitted.length === 0) {
        throw new BadRequestError(
          "NO_EVIDENCE",
          "No unsubmitted evidence to submit.",
        );
      }

      const now = new Date();
      await tx.disputeEvidence.updateMany({
        where: { disputeId: dispute.id, submittedAt: null },
        data: { submittedAt: now },
      });

      disputeMachine.assertTransition(
        dispute.status as DisputeStatus,
        "UNDER_REVIEW",
      );

      const updated = await tx.dispute.update({
        where: { id: dispute.id },
        data: { status: "UNDER_REVIEW" },
      });

      const submittedEvidence = await tx.disputeEvidence.findMany({
        where: { disputeId: dispute.id, submittedAt: now },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "dispute.evidence.submitted",
        entityType: "Dispute",
        entityId: dispute.id,
        payload: {
          ...serializeDispute(updated),
          evidence_count: submittedEvidence.length,
        } as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return { dispute: updated, evidence: submittedEvidence };
    });

    return NextResponse.json({
      dispute: serializeDispute(result.dispute),
      evidence: result.evidence.map(serializeEvidence),
    });
  },
});
