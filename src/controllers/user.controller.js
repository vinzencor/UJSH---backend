import User from "../models/User.js";
import RoleModuleAccess from "../models/RoleModuleAccess.js";
import { catchAsync, sendSuccess, createError } from "../utils/helpers.js";
import { ROLES, MODULE_KEYS } from "../config/constants.js";

// ─── Get profile ─────────────────────────────────────────────────────────────
export const getProfile = catchAsync(async (req, res) => {
  const userId = req.params.id || req.user._id;
  const user = await User.findById(userId).select("-password");
  if (!user) throw createError("User not found.", 404);
  sendSuccess(res, user.toSafeJSON());
});

// ─── Update own profile ───────────────────────────────────────────────────────
export const updateProfile = catchAsync(async (req, res, next) => {
  const { fullName, institution, bio, socialLinks, photoUrl, reviewerCategory } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) return next(createError("User not found.", 404));

  if (fullName !== undefined) user.fullName = fullName;
  if (institution !== undefined) user.institution = institution;
  if (bio !== undefined) user.bio = bio;
  if (reviewerCategory !== undefined) user.reviewerCategory = reviewerCategory;
  if (photoUrl !== undefined) user.photoUrl = photoUrl;
  if (socialLinks !== undefined) {
    user.socialLinks = new Map(Object.entries(socialLinks));
  }

  await user.save();
  sendSuccess(res, user.toSafeJSON(), 200, "Profile updated.");
});

// ─── Admin: list all users ────────────────────────────────────────────────────
export const listUsers = catchAsync(async (req, res) => {
  const { role, search, page = 1, limit = 50 } = req.query;
  const filter = {};
  if (role) filter.roles = role;
  if (search) {
    filter.$or = [
      { fullName: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [users, total] = await Promise.all([
    User.find(filter).select("-password").skip(skip).limit(Number(limit)).sort({ createdAt: -1 }),
    User.countDocuments(filter),
  ]);

  sendSuccess(res, { users, total, page: Number(page), limit: Number(limit) });
});

// ─── Admin: assign roles ──────────────────────────────────────────────────────
export const assignRoles = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { roles } = req.body;

  if (!Array.isArray(roles)) return next(createError("roles must be an array.", 400));
  const invalid = roles.filter((r) => !Object.values(ROLES).includes(r));
  if (invalid.length) return next(createError(`Invalid roles: ${invalid.join(", ")}`, 400));

  const user = await User.findByIdAndUpdate(
    userId,
    { roles },
    { new: true, select: "-password" }
  );
  if (!user) return next(createError("User not found.", 404));

  sendSuccess(res, user.toSafeJSON(), 200, "Roles updated.");
});

// ─── Admin: add a single role ─────────────────────────────────────────────────
export const addRole = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { role } = req.body;
  if (!Object.values(ROLES).includes(role)) return next(createError("Invalid role.", 400));

  const user = await User.findByIdAndUpdate(
    userId,
    { $addToSet: { roles: role } },
    { new: true, select: "-password" }
  );
  if (!user) return next(createError("User not found.", 404));
  sendSuccess(res, user.toSafeJSON());
});

// ─── Admin: remove a single role ─────────────────────────────────────────────
export const removeRole = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { role } = req.body;

  const user = await User.findByIdAndUpdate(
    userId,
    { $pull: { roles: role } },
    { new: true, select: "-password" }
  );
  if (!user) return next(createError("User not found.", 404));
  sendSuccess(res, user.toSafeJSON());
});

// ─── Admin: get / set role-module access ──────────────────────────────────────
export const getRoleModuleAccess = catchAsync(async (req, res) => {
  const records = await RoleModuleAccess.find({});
  sendSuccess(res, records);
});

export const setRoleModuleAccess = catchAsync(async (req, res, next) => {
  const { roleName, moduleKey, canAccess } = req.body;
  if (!Object.values(ROLES).includes(roleName)) return next(createError("Invalid role.", 400));
  if (!MODULE_KEYS.includes(moduleKey)) return next(createError("Invalid module key.", 400));

  const record = await RoleModuleAccess.findOneAndUpdate(
    { roleName, moduleKey },
    { canAccess },
    { upsert: true, new: true }
  );
  sendSuccess(res, record);
});

// ─── Admin: deactivate / activate user ───────────────────────────────────────
export const toggleUserActive = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const user = await User.findById(userId);
  if (!user) return next(createError("User not found.", 404));
  user.isActive = !user.isActive;
  await user.save();
  sendSuccess(res, { isActive: user.isActive });
});
// ─── Admin: delete user ──────────────────────────────────────────────────────
export const deleteUser = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const user = await User.findByIdAndDelete(userId);
  if (!user) return next(createError("User not found.", 404));
  sendSuccess(res, null, 200, "User permanently deleted.");
});
