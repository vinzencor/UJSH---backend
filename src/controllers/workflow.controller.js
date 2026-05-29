import WorkflowTemplate from "../models/WorkflowTemplate.js";
import WorkflowStage from "../models/WorkflowStage.js";
import WorkflowLog from "../models/WorkflowLog.js";
import ContentItem from "../models/ContentItem.js";
import JournalSubmission from "../models/JournalSubmission.js";
import SubAdminScore from "../models/SubAdminScore.js";
import { catchAsync, sendSuccess, createError } from "../utils/helpers.js";

// ─── Templates ────────────────────────────────────────────────────────────────

export const listTemplates = catchAsync(async (req, res) => {
  const templates = await WorkflowTemplate.find({}).sort({ createdAt: -1 });
  sendSuccess(res, templates);
});

export const createTemplate = catchAsync(async (req, res, next) => {
  const { name } = req.body;
  if (!name) return next(createError("Template name is required.", 400));
  const template = await WorkflowTemplate.create({ name, createdBy: req.user._id });
  sendSuccess(res, template, 201);
});

export const updateTemplate = catchAsync(async (req, res, next) => {
  const template = await WorkflowTemplate.findByIdAndUpdate(
    req.params.id,
    { name: req.body.name, isActive: req.body.isActive },
    { new: true }
  );
  if (!template) return next(createError("Template not found.", 404));
  sendSuccess(res, template);
});

export const deleteTemplate = catchAsync(async (req, res, next) => {
  const t = await WorkflowTemplate.findByIdAndDelete(req.params.id);
  if (!t) return next(createError("Template not found.", 404));
  await WorkflowStage.deleteMany({ template: req.params.id });
  sendSuccess(res, null, 200, "Template deleted.");
});

// ─── Stages ───────────────────────────────────────────────────────────────────

export const getStages = catchAsync(async (req, res) => {
  const stages = await WorkflowStage.find({ template: req.params.templateId })
    .populate("assignedUser", "fullName email")
    .sort({ orderIndex: 1 });
  sendSuccess(res, stages);
});

export const upsertStages = catchAsync(async (req, res, next) => {
  const { templateId } = req.params;
  const { stages } = req.body; // Array of { stageName, orderIndex, assignedUser }
  if (!Array.isArray(stages)) return next(createError("stages must be an array.", 400));

  await WorkflowStage.deleteMany({ template: templateId });
  const docs = stages.map((s) => ({
    template: templateId,
    stageName: s.stageName,
    orderIndex: s.orderIndex,
    assignedUser: s.assignedUser || null,
  }));
  const created = await WorkflowStage.insertMany(docs);
  sendSuccess(res, created);
});

// ─── Sub-admin: get my assigned stage content ─────────────────────────────────

export const getMyQueue = catchAsync(async (req, res) => {
  // Find stages assigned to this user
  const stages = await WorkflowStage.find({ assignedUser: req.user._id });
  if (!stages.length) return sendSuccess(res, []);

  // Build a precise filter: for each stage, match template + orderIndex
  const orConditions = stages.map((s) => ({
    workflowTemplate: s.template,
    currentStageIndex: s.orderIndex,
  }));

  const [articles, journals] = await Promise.all([
    ContentItem.find({
      $or: orConditions,
      workflowStatus: { $in: ["submitted", "in_review"] },
    }).populate("authorUser", "fullName email institution"),
    JournalSubmission.find({
      $or: orConditions,
      status: { $in: ["submitted", "in_review"] },
    }).populate("authorUser", "fullName email institution"),
  ]);

  // Tag them so frontend knows type
  const items = [
    ...articles.map((a) => ({ ...a.toObject(), itemType: "article" })),
    ...journals.map((j) => ({ ...j.toObject(), itemType: "journal" })),
  ];

  sendSuccess(res, items);
});

// ─── Sub-admin: take action on content ───────────────────────────────────────

export const reviewAction = catchAsync(async (req, res, next) => {
  const { contentId } = req.params;
  const { action, comment, accessMode, ppvPrice } = req.body;

  const VALID_ACTIONS = ["approved", "changes_requested", "rejected"];
  if (!VALID_ACTIONS.includes(action)) {
    return next(createError(`Action must be one of: ${VALID_ACTIONS.join(", ")}`, 400));
  }

  // Try finding in ContentItem first, then JournalSubmission
  let item = await ContentItem.findById(contentId).populate("workflowTemplate");
  let isJournal = false;

  if (!item) {
    item = await JournalSubmission.findById(contentId).populate("workflowTemplate");
    if (item) isJournal = true;
  }

  if (!item) return next(createError("Content not found.", 404));

  // Verify sub-admin is assigned to current stage
  const stage = await WorkflowStage.findOne({
    template: item.workflowTemplate?._id || item.workflowTemplate,
    orderIndex: item.currentStageIndex,
    assignedUser: req.user._id,
  });

  if (!stage && !req.user.hasAnyRole(["super_admin", "editor", "content_admin"])) {
    return next(createError("You are not assigned to this stage.", 403));
  }

  // Log the action
  await WorkflowLog.create({
    content: contentId,
    stage: stage?._id,
    stageIndex: item.currentStageIndex,
    action,
    comment: comment || "",
    actedBy: req.user._id,
  });

  if (action === "approved") {
    // Save access settings if provided by this reviewer
    if (accessMode) item.accessMode = accessMode;
    if (ppvPrice !== undefined) item.ppvPrice = ppvPrice;

    // Count total stages
    const templateId = item.workflowTemplate?._id || item.workflowTemplate;
    const totalStages = await WorkflowStage.countDocuments({ template: templateId });
    
    if (item.currentStageIndex + 1 >= totalStages) {
      // Final stage – publish
      item.status = "published";
      if (!isJournal) item.workflowStatus = "published";
    } else {
      item.currentStageIndex += 1;
      if (isJournal) item.status = "in_review";
      else item.workflowStatus = "in_review";
    }
    // Clear any prior change-request info
    if (isJournal) {
      item.returnToStageIndex = null;
      item.reviewerComment = "";
    }
  } else if (action === "changes_requested") {
    if (isJournal) {
      item.status = "changes_requested";
      // Remember which stage sent it back so resubmission returns here
      item.returnToStageIndex = item.currentStageIndex;
      item.reviewerComment = comment || "";
    } else {
      item.workflowStatus = "changes_requested";
    }
  } else if (action === "rejected") {
    item.status = isJournal ? "rejected" : "archived";
    if (!isJournal) item.workflowStatus = "rejected";
  }

  item.updatedBy = req.user._id;
  await item.save();

  // Update sub-admin score
  await _updateSubAdminScore(req.user._id, action);

  sendSuccess(res, item, 200, "Action recorded.");
});

// ─── Workflow logs for a content item ─────────────────────────────────────────

export const getContentLogs = catchAsync(async (req, res) => {
  const logs = await WorkflowLog.find({ content: req.params.contentId })
    .populate("actedBy", "fullName email")
    .populate("stage", "stageName orderIndex")
    .sort({ actedAt: -1 });
  sendSuccess(res, logs);
});

// ─── Sub-admin score ─────────────────────────────────────────────────────────

export const getMyScore = catchAsync(async (req, res) => {
  const score = await SubAdminScore.findOne({ user: req.user._id });
  sendSuccess(res, score || { totalScore: 0, approvals: 0, changesRequested: 0, rejections: 0 });
});

// Internal helper
async function _updateSubAdminScore(userId, action) {
  const increment = {};
  if (action === "approved") {
    increment.approvals = 1;
    increment.totalScore = 10;
    increment.currentStreak = 1;
  } else if (action === "changes_requested") {
    increment.changesRequested = 1;
    increment.totalScore = 5;
  } else if (action === "rejected") {
    increment.rejections = 1;
    increment.totalScore = 3;
  }

  await SubAdminScore.findOneAndUpdate(
    { user: userId },
    { $inc: increment, $set: { lastActivityAt: new Date() } },
    { upsert: true, new: true }
  );
}
