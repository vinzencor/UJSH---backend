import mongoose from "mongoose";

const ACTIONS = ["submitted", "approved", "changes_requested", "rejected", "resubmitted"];

const workflowLogSchema = new mongoose.Schema(
  {
    content: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContentItem",
      required: true,
    },
    stage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkflowStage",
    },
    stageIndex: { type: Number },
    action: { type: String, enum: ACTIONS, required: true },
    comment: { type: String, default: "" },
    actedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    actedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

const WorkflowLog = mongoose.model("WorkflowLog", workflowLogSchema);
export default WorkflowLog;
