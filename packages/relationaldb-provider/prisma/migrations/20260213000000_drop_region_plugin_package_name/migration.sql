-- DropColumn
ALTER TABLE "region_plugins" DROP COLUMN IF EXISTS "package_name";

-- AlterColumnDefault
ALTER TABLE "region_plugins" ALTER COLUMN "plugin_type" SET DEFAULT 'declarative';
