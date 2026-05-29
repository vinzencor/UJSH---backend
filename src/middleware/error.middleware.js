/**
 * Global error handling middleware.
 * Must be registered after all routes in app.js.
 */
const errorHandler = (err, req, res, _next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0];
    message = `${field ? field.charAt(0).toUpperCase() + field.slice(1) : "Field"} already exists.`;
    statusCode = 409;
  }

  // Mongoose validation errors
  if (err.name === "ValidationError") {
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(", ");
    statusCode = 400;
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    message = "Invalid token.";
    statusCode = 401;
  }
  if (err.name === "TokenExpiredError") {
    message = "Token expired.";
    statusCode = 401;
  }

  if (process.env.NODE_ENV !== "production") {
    console.error("[GRGH Error]", err);
  }

  res.status(statusCode).json({ success: false, message });
};

export default errorHandler;
