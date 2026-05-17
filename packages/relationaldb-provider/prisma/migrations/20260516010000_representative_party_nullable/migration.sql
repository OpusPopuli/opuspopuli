-- Make party nullable on representatives — Board of Supervisors members are nonpartisan
ALTER TABLE "representatives" ALTER COLUMN "party" DROP NOT NULL;
