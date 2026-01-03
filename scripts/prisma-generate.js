const { execSync } = require("node:child_process");

require("dotenv").config();

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const hasDirectUrl = Boolean(process.env.DATABASE_URL_UNPOOLED);

if (!hasDatabaseUrl || !hasDirectUrl) {
  console.log(
    "Skipping prisma generate; DATABASE_URL or DATABASE_URL_UNPOOLED is not set."
  );
  process.exit(0);
}

execSync("prisma generate", { stdio: "inherit" });
