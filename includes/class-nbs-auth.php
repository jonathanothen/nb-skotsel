<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Behörighet: WP-rollen "Biodlare" ger tillgång till appen. Inom appen styrs allt
 * av medlemskap i en organisation (ägare, admin, medlem, läsare). Användarens
 * aktiva organisation sparas i användarmeta.
 */
class NBS_Auth {

	const ROLES = ['owner' => 'Ägare', 'admin' => 'Administratör', 'member' => 'Medlem', 'viewer' => 'Läsare'];

	public static function install_roles() {
		add_role('nbs_biodlare', 'Biodlare', ['read' => true, 'nbs_access' => true]);
		$admin = get_role('administrator');
		if ($admin) {
			$admin->add_cap('nbs_access');
		}
	}

	/** Skapar organisationen "Nordiska Bin" med nuvarande admin som ägare om ingen finns. */
	public static function ensure_default_org() {
		global $wpdb;
		$orgs = NBS_DB::table('orgs');
		$has  = (int) $wpdb->get_var("SELECT COUNT(*) FROM $orgs");
		if ($has) {
			return;
		}
		$id  = wp_generate_uuid4();
		$now = NBS_DB::now();
		$wpdb->insert($orgs, ['id' => $id, 'name' => get_bloginfo('name') ?: 'Min biodling', 'created_at' => $now, 'updated_at' => $now]);
		$user = get_current_user_id();
		if (!$user) {
			$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
			$user   = $admins ? (int) $admins[0] : 0;
		}
		if ($user) {
			$wpdb->insert(NBS_DB::table('members'), ['org_id' => $id, 'user_id' => $user, 'role' => 'owner', 'created_at' => $now]);
			update_user_meta($user, 'nbs_org', $id);
		}
	}

	public static function can_access() {
		return is_user_logged_in() && (current_user_can('nbs_access') || current_user_can('manage_options'));
	}

	/** Användarens organisationer: [ [id, name, role], ... ] */
	public static function orgs($user_id = 0) {
		global $wpdb;
		$user_id = $user_id ?: get_current_user_id();
		$o = NBS_DB::table('orgs');
		$m = NBS_DB::table('members');
		return $wpdb->get_results($wpdb->prepare("SELECT o.id, o.name, m.role FROM $m m JOIN $o o ON o.id = m.org_id WHERE m.user_id = %d ORDER BY o.name", $user_id), ARRAY_A);
	}

	/** Aktiv organisation och roll för inloggad användare, eller null. */
	public static function current() {
		static $cache = null;
		if ($cache !== null) {
			return $cache ?: null;
		}
		$orgs = self::orgs();
		if (!$orgs) {
			$cache = false;
			return null;
		}
		$want = get_user_meta(get_current_user_id(), 'nbs_org', true);
		foreach ($orgs as $o) {
			if ($o['id'] === $want) {
				return $cache = $o;
			}
		}
		return $cache = $orgs[0];
	}

	public static function org_id() {
		$c = self::current();
		return $c ? $c['id'] : null;
	}

	/** Organisationens inställningar (bl.a. egna fält per register). */
	public static function org_settings($org_id) {
		global $wpdb;
		$raw = $wpdb->get_var($wpdb->prepare('SELECT settings FROM ' . NBS_DB::table('orgs') . ' WHERE id = %s', $org_id));
		return NBS_Repo::unjson($raw);
	}

	public static function save_org_settings($org_id, $settings) {
		global $wpdb;
		$wpdb->update(NBS_DB::table('orgs'), ['settings' => NBS_Repo::json($settings), 'updated_at' => NBS_DB::now()], ['id' => $org_id]);
	}

	/** Får användaren skriva (medlem eller högre)? */
	public static function can_write() {
		$c = self::current();
		return $c && in_array($c['role'], ['owner', 'admin', 'member'], true);
	}

	/** Får användaren hantera organisationen (ägare/admin)? */
	public static function can_manage() {
		$c = self::current();
		return $c && in_array($c['role'], ['owner', 'admin'], true);
	}
}
