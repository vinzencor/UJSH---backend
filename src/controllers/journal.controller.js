import JournalSubmission from "../models/JournalSubmission.js";
import WorkflowTemplate from "../models/WorkflowTemplate.js";
import WorkflowStage from "../models/WorkflowStage.js";
import { catchAsync, sendSuccess, createError } from "../utils/helpers.js";
import { getUploadedS3Keys } from "../utils/upload.js";

const parseMaybeArray = (value) => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [trimmed];
    } catch {
      return trimmed
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    }
  }
  return [value];
};

const resolveUploadedUrls = (files = {}) => ({
  manuscriptUrl: files.manuscript?.[0]
    ? files.manuscript[0].s3Url
    : undefined,
  supplementaryFileUrl: files.supplementary?.[0]
    ? files.supplementary[0].s3Url
    : undefined,
  coverImageUrl: files.coverImage?.[0]
    ? files.coverImage[0].s3Url
    : undefined,
});

export const createJournalDraft = catchAsync(async (req, res, next) => {
  const { title, abstract, body, institution, workflowTemplateId } = req.body;
  if (!title) return next(createError("Title is required.", 400));

  let workflowTemplate = null;
  if (workflowTemplateId) {
    workflowTemplate = await WorkflowTemplate.findById(workflowTemplateId);
    if (!workflowTemplate) return next(createError("Workflow template not found.", 404));
  } else {
    workflowTemplate = await WorkflowTemplate.findOne({ isActive: true });
  }

  const { manuscriptUrl, supplementaryFileUrl, coverImageUrl } = resolveUploadedUrls(req.files);

  const journal = await JournalSubmission.create({
    title,
    abstract,
    body,
    institution: institution || req.user.institution || "",
    manuscriptUrl: manuscriptUrl || "",
    supplementaryFileUrl: supplementaryFileUrl || "",
    coverImageUrl: coverImageUrl || "",
    keywords: parseMaybeArray(req.body.keywords) || [],
    coAuthors: parseMaybeArray(req.body.coAuthors) || [],
    status: "draft",
    authorUser: req.user._id,
    workflowTemplate: workflowTemplate?._id || null,
    createdBy: req.user._id,
  });

  const response = journal.toObject();
  response.uploadedS3Keys = getUploadedS3Keys(req);
  sendSuccess(res, response, 201, "Journal draft created.");
});

export const submitJournal = catchAsync(async (req, res, next) => {
  const { title, abstract, body, institution, workflowTemplateId } = req.body;
  if (!title) return next(createError("Title is required.", 400));

  let workflowTemplate = null;
  if (workflowTemplateId) {
    workflowTemplate = await WorkflowTemplate.findById(workflowTemplateId);
    if (!workflowTemplate) return next(createError("Workflow template not found.", 404));
  } else {
    workflowTemplate = await WorkflowTemplate.findOne({ isActive: true });
  }

  const { manuscriptUrl, supplementaryFileUrl, coverImageUrl } = resolveUploadedUrls(req.files);
  if (!manuscriptUrl) {
    return next(createError("Manuscript file is required for journal submission.", 400));
  }

  const journal = await JournalSubmission.create({
    title,
    abstract,
    body,
    institution: institution || req.user.institution || "",
    manuscriptUrl,
    supplementaryFileUrl: supplementaryFileUrl || "",
    coverImageUrl: coverImageUrl || "",
    keywords: parseMaybeArray(req.body.keywords) || [],
    coAuthors: parseMaybeArray(req.body.coAuthors) || [],
    status: "submitted",
    authorUser: req.user._id,
    workflowTemplate: workflowTemplate?._id || null,
    createdBy: req.user._id,
  });

  const response = journal.toObject();
  response.uploadedS3Keys = getUploadedS3Keys(req);
  sendSuccess(res, response, 201, "Journal submitted for review.");
});

export const listMyJournals = catchAsync(async (req, res) => {
  const journals = await JournalSubmission.find({ authorUser: req.user._id })
    .sort({ createdAt: -1 });
  sendSuccess(res, journals);
});

export const updateJournal = catchAsync(async (req, res, next) => {
  const journal = await JournalSubmission.findById(req.params.id);
  if (!journal) return next(createError("Journal submission not found.", 404));

  const isOwner = journal.authorUser.toString() === req.user._id.toString();
  const isAdmin = req.user.hasAnyRole(["super_admin", "content_admin", "editor"]);
  if (!isOwner && !isAdmin) return next(createError("Forbidden.", 403));

  const updatable = ["title", "abstract", "body", "institution", "status", "workflowTemplate", "originalAuthorName"];
  updatable.forEach((field) => {
    if (req.body[field] !== undefined) {
      journal[field] = req.body[field];
    }
  });

  if (req.body.publishDate !== undefined) {
    journal.publishDate = req.body.publishDate ? new Date(req.body.publishDate) : null;
  }

  if (req.body.keywords !== undefined) {
    journal.keywords = parseMaybeArray(req.body.keywords) || [];
  }
  if (req.body.coAuthors !== undefined) {
    journal.coAuthors = parseMaybeArray(req.body.coAuthors) || [];
  }

  const { manuscriptUrl, supplementaryFileUrl, coverImageUrl } = resolveUploadedUrls(req.files);
  if (manuscriptUrl) journal.manuscriptUrl = manuscriptUrl;
  if (supplementaryFileUrl) journal.supplementaryFileUrl = supplementaryFileUrl;
  if (coverImageUrl) journal.coverImageUrl = coverImageUrl;

  journal.updatedBy = req.user._id;
  await journal.save();

  const response = journal.toObject();
  response.uploadedS3Keys = getUploadedS3Keys(req);
  sendSuccess(res, response, 200, "Journal updated.");
});

export const submitDraftJournal = catchAsync(async (req, res, next) => {
  const journal = await JournalSubmission.findById(req.params.id);
  if (!journal) return next(createError("Journal submission not found.", 404));

  if (journal.authorUser.toString() !== req.user._id.toString()) {
    return next(createError("Forbidden.", 403));
  }

  if (!["draft", "changes_requested"].includes(journal.status)) {
    return next(createError("This journal cannot be submitted in its current state.", 400));
  }

  const { manuscriptUrl } = resolveUploadedUrls(req.files);
  if (manuscriptUrl) journal.manuscriptUrl = manuscriptUrl;

  if (!journal.manuscriptUrl) {
    return next(createError("Manuscript file is required before submitting.", 400));
  }

  if (req.body.title) journal.title = req.body.title;
  if (req.body.abstract !== undefined) journal.abstract = req.body.abstract;
  if (req.body.body !== undefined) journal.body = req.body.body;
  if (req.body.keywords !== undefined) {
    journal.keywords = parseMaybeArray(req.body.keywords) || [];
  }
  if (req.body.coAuthors !== undefined) {
    journal.coAuthors = parseMaybeArray(req.body.coAuthors) || [];
  }

  // If resubmitting after changes_requested, go back to the reviewer stage
  if (journal.returnToStageIndex !== null && journal.returnToStageIndex !== undefined) {
    journal.currentStageIndex = journal.returnToStageIndex;
    journal.returnToStageIndex = null;
  }

  journal.status = "submitted";
  journal.reviewerComment = ""; // Clear old feedback
  journal.updatedBy = req.user._id;
  await journal.save();

  const response = journal.toObject();
  response.uploadedS3Keys = getUploadedS3Keys(req);
  sendSuccess(res, response, 200, "Journal resubmitted for review.");
});

export const adminUploadJournal = catchAsync(async (req, res, next) => {
  const { title, abstract, body, institution, workflowTemplateId, originalAuthorName, publishDate } = req.body;
  if (!title) return next(createError("Title is required.", 400));
  if (!originalAuthorName) return next(createError("Author name is required.", 400));

  const { manuscriptUrl, supplementaryFileUrl, coverImageUrl } = resolveUploadedUrls(req.files);
  if (!manuscriptUrl) {
    return next(createError("PDF manuscript file is required.", 400));
  }

  let workflowTemplate = null;
  if (workflowTemplateId) {
    workflowTemplate = await WorkflowTemplate.findById(workflowTemplateId);
    if (!workflowTemplate) return next(createError("Workflow template not found.", 404));
  } else {
    workflowTemplate = await WorkflowTemplate.findOne({ isActive: true });
  }

  const journal = await JournalSubmission.create({
    title,
    abstract: abstract || "",
    body: body || "",
    originalAuthorName,
    institution: institution || "",
    manuscriptUrl,
    supplementaryFileUrl: supplementaryFileUrl || "",
    coverImageUrl: coverImageUrl || "",
    keywords: parseMaybeArray(req.body.keywords) || [],
    coAuthors: parseMaybeArray(req.body.coAuthors) || [],
    status: "submitted",
    authorUser: req.user._id,
    publishDate: publishDate ? new Date(publishDate) : null,
    uploadedBySuperAdmin: true,
    workflowTemplate: workflowTemplate?._id || null,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  const response = journal.toObject();
  response.uploadedS3Keys = getUploadedS3Keys(req);
  sendSuccess(res, response, 201, "Paper uploaded by super admin.");
});


export const listPublishedJournals = catchAsync(async (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;
  const filter = { status: "published" };
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: "i" } },
      { abstract: { $regex: search, $options: "i" } },
      { keywords: { $regex: search, $options: "i" } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    JournalSubmission.find(filter)
      .populate("authorUser", "fullName institution photoUrl")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    JournalSubmission.countDocuments(filter),
  ]);

  sendSuccess(res, { items, total, page: Number(page), limit: Number(limit) });
});

export const getJournalBySlug = catchAsync(async (req, res, next) => {
  const item = await JournalSubmission.findOne({
    slug: req.params.slug,
    status: "published",
  }).populate("authorUser", "fullName institution photoUrl bio");

  if (!item) return next(createError("Journal not found.", 404));

  item.viewCount += 1;
  await item.save();

  sendSuccess(res, item);
});

export const listAllJournals = catchAsync(async (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const filter = {};
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const [rawItems, total] = await Promise.all([
    JournalSubmission.find(filter)
      .populate("authorUser", "fullName email institution")
      .populate("workflowTemplate", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    JournalSubmission.countDocuments(filter),
  ]);

  // Enhance items with stage counts
  const items = await Promise.all(rawItems.map(async (item) => {
    const obj = item.toObject();
    if (obj.workflowTemplate) {
      const stageCount = await WorkflowStage.countDocuments({ template: obj.workflowTemplate._id });
      obj.totalStages = stageCount;
    } else {
      obj.totalStages = 0;
    }
    return obj;
  }));

  sendSuccess(res, { items, total, page: Number(page), limit: Number(limit) });
});

export const deleteJournal = catchAsync(async (req, res, next) => {
  const item = await JournalSubmission.findByIdAndDelete(req.params.id);
  if (!item) return next(createError("Journal submission not found.", 404));
  sendSuccess(res, null, 200, "Journal deleted.");
});