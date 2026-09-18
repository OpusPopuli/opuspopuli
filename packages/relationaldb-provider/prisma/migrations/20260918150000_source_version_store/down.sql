-- Rollback for #1276.
--
-- Drops the table and everything it owns. This DESTROYS every stored source
-- artifact — the bytes are not recoverable from anywhere else, since the whole
-- point of the table is that they exist nowhere but here. Take a dump first if
-- the store has been in use.
DROP TABLE IF EXISTS "source_versions";
