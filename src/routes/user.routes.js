import { Router } from "express";
import {
  getProfile,
  updateProfile,
  listUsers,
  assignRoles,
  addRole,
  removeRole,
  getRoleModuleAccess,
  setRoleModuleAccess,
  toggleUserActive,
  deleteUser,
} from "../controllers/user.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { requireRoles } from "../middleware/role.middleware.js";

const router = Router();

// Own profile
router.get("/me", protect, getProfile);
router.patch("/me", protect, updateProfile);

// Public profile view (by id)
router.get("/:id", getProfile);

// Admin routes
router.get("/", protect, requireRoles("super_admin", "content_admin", "editor"), listUsers);
router.patch("/:userId/roles", protect, requireRoles("super_admin"), assignRoles);
router.post("/:userId/roles/add", protect, requireRoles("super_admin"), addRole);
router.post("/:userId/roles/remove", protect, requireRoles("super_admin"), removeRole);
router.patch("/:userId/toggle-active", protect, requireRoles("super_admin"), toggleUserActive);
router.delete("/:userId", protect, requireRoles("super_admin"), deleteUser);


// Role module access
router.get(
  "/admin/role-module-access",
  protect,
  requireRoles("super_admin"),
  getRoleModuleAccess
);
router.post(
  "/admin/role-module-access",
  protect,
  requireRoles("super_admin"),
  setRoleModuleAccess
);

export default router;
