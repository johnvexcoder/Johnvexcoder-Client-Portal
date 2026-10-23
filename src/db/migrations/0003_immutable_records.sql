INSERT OR IGNORE INTO project_controls (project_id, revision, baseline_version) SELECT id, 1, 0 FROM projects;
--> statement-breakpoint
INSERT OR IGNORE INTO access_policies (user_id, must_rotate, created_at) SELECT id, 1, created_at FROM user WHERE role = 'client';
--> statement-breakpoint
CREATE TRIGGER package_versions_no_update BEFORE UPDATE ON package_versions BEGIN SELECT RAISE(ABORT, 'Package versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER package_versions_no_delete BEFORE DELETE ON package_versions BEGIN SELECT RAISE(ABORT, 'Package versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER approved_submissions_no_update BEFORE UPDATE ON approved_submissions BEGIN SELECT RAISE(ABORT, 'Approved submissions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER approved_submissions_no_delete BEFORE DELETE ON approved_submissions BEGIN SELECT RAISE(ABORT, 'Approved submissions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER scope_amendments_no_update BEFORE UPDATE ON scope_amendments BEGIN SELECT RAISE(ABORT, 'Scope amendments are immutable'); END;
