module.exports = {
  apps: [
    {
      name: "worker",
      script: "dist/lib/worker.js",
      env: {
        NODE_ENV: "production",
        REDIS_URL: "redis://default:Sam002srDe1ErzKFIxVLGKDp2clWMtCy@redis-12626.crce179.ap-south-1-1.ec2.cloud.redislabs.com:12626"
      }
    },
    {
      name: "outboxworker",
      script: "dist/lib/outboxworker.js",
      env: {
        NODE_ENV: "production",
        REDIS_URL: "redis://default:Sam002srDe1ErzKFIxVLGKDp2clWMtCy@redis-12626.crce179.ap-south-1-1.ec2.cloud.redislabs.com:12626"
      }
    }
  ]
};