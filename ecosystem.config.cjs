module.exports = {
    apps: [
        {
            name: "fastapi-backend",
            script: "venv/bin/python",
            args: "-m uvicorn decentralized_api:app --port 8001 --host 0.0.0.0",
            cwd: "/home/user/micro_grid",
            interpreter: "none",
            autorestart: true,
            watch: false,
            env: {
                "NODE_ENV": "production",
            }
        },
        {
            name: "vite-frontend",
            script: "npm",
            args: "run dev -- --host 0.0.0.0",
            cwd: "/home/user/micro_grid/ems-web",
            autorestart: true,
            watch: false,
            env: {
                "NODE_ENV": "production",
            }
        }
    ]
};
