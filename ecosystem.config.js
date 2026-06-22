module.exports = {
  apps: [
    {
      name: "indian-dummy-set",
      script: "./dist/server.cjs",
      instances: 1, // Use 1 instance since SQLite + Socket.IO in-memory state doesn't scale easily across multiple processes without a Redis adapter
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 8080,
      },
    },
  ],
};
