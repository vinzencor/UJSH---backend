import User from "../models/User.js";
import Membership from "../models/Membership.js";
import ContentItem from "../models/ContentItem.js";
import Review from "../models/Review.js";
import Invoice from "../models/Invoice.js";
import WorkflowStage from "../models/WorkflowStage.js";
import SubAdminScore from "../models/SubAdminScore.js";
import { catchAsync, sendSuccess } from "../utils/helpers.js";

// ─── Platform analytics overview ─────────────────────────────────────────────
export const getAnalytics = catchAsync(async (req, res) => {
  const [
    totalUsers,
    totalContent,
    publishedContent,
    activeMemberships,
    pendingMemberships,
    totalReviews,
    submittedReviews,
  ] = await Promise.all([
    User.countDocuments({ isActive: true }),
    ContentItem.countDocuments({}),
    ContentItem.countDocuments({ status: "published" }),
    Membership.countDocuments({ status: { $in: ["active", "renewal_due"] } }),
    Membership.countDocuments({ status: "pending_verification" }),
    Review.countDocuments({}),
    Review.countDocuments({ status: "submitted" }),
  ]);

  sendSuccess(res, {
    users: { total: totalUsers },
    content: { total: totalContent, published: publishedContent },
    memberships: { active: activeMemberships, pending: pendingMemberships },
    reviews: { total: totalReviews, submitted: submittedReviews },
  });
});

// ─── Pipeline overview (journal submission pipeline) ─────────────────────────
export const getPipeline = catchAsync(async (req, res) => {
  const pipeline = await ContentItem.aggregate([
    {
      $group: {
        _id: "$workflowStatus",
        count: { $sum: 1 },
      },
    },
  ]);

  const result = {};
  pipeline.forEach(({ _id, count }) => {
    result[_id] = count;
  });

  sendSuccess(res, result);
});

// ─── Sub-admin leaderboard ────────────────────────────────────────────────────
export const getSubAdminLeaderboard = catchAsync(async (req, res) => {
  const scores = await SubAdminScore.find({})
    .populate("user", "fullName email photoUrl")
    .sort({ totalScore: -1 })
    .limit(20);
  sendSuccess(res, scores);
});

// ─── Sub-admin assigned stage users ──────────────────────────────────────────
export const getSubAdminUsers = catchAsync(async (req, res) => {
  const stages = await WorkflowStage.find({ assignedUser: { $ne: null } })
    .populate("assignedUser", "fullName email photoUrl roles")
    .populate("template", "name");

  // Group by user
  const userMap = {};
  stages.forEach((s) => {
    if (!s.assignedUser) return;
    const uid = s.assignedUser._id.toString();
    if (!userMap[uid]) {
      userMap[uid] = {
        user: s.assignedUser,
        assignedStages: [],
      };
    }
    userMap[uid].assignedStages.push({
      template: s.template?.name,
      stageName: s.stageName,
      orderIndex: s.orderIndex,
    });
  });

  sendSuccess(res, Object.values(userMap));
});
