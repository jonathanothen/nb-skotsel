<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * REST-API /wp-json/nbs/v1/. Allt kräver inloggning och medlemskap i en organisation.
 * Läsning: alla medlemmar. Skrivning: medlem eller högre. Organisation: ägare/admin.
 */
class NBS_Rest {

	const NS = 'nbs/v1';

	public static function can_read() {
		return NBS_Auth::can_access() && NBS_Auth::org_id() !== null;
	}

	public static function can_write() {
		return self::can_read() && NBS_Auth::can_write();
	}

	public static function can_manage() {
		return self::can_read() && NBS_Auth::can_manage();
	}

	private static function route($path, $methods, $cb, $perm = 'can_read') {
		register_rest_route(self::NS, $path, [
			'methods'             => $methods,
			'callback'            => $cb,
			'permission_callback' => [__CLASS__, $perm],
		]);
	}

	private static function out($res) {
		return is_wp_error($res) ? $res : rest_ensure_response($res);
	}

	public static function routes() {
		$org = function () {
			return NBS_Auth::org_id();
		};

		self::route('/me', 'GET', function () {
			$u = wp_get_current_user();
			$c = NBS_Auth::current();
			return [
				'user' => ['id' => $u->ID, 'name' => $u->display_name, 'email' => $u->user_email],
				'org'  => $c,
				'orgs' => NBS_Auth::orgs(),
				'can'  => ['write' => NBS_Auth::can_write(), 'manage' => NBS_Auth::can_manage()],
				'version' => NBS_VERSION,
			];
		});

		self::route('/org/switch', 'POST', function (WP_REST_Request $r) {
			$id = (string) $r['org_id'];
			foreach (NBS_Auth::orgs() as $o) {
				if ($o['id'] === $id) {
					update_user_meta(get_current_user_id(), 'nbs_org', $id);
					return ['ok' => true];
				}
			}
			return new WP_Error('nbs_org', 'Du är inte medlem i den organisationen.', ['status' => 403]);
		});

		// ---- Listor
		self::route('/lists', 'GET', function () use ($org) {
			NBS_Starter::ensure_system_lists($org());
			return NBS_Lists::all($org());
		});
		self::route('/lists', 'POST', function (WP_REST_Request $r) use ($org) {
			return self::out(NBS_Lists::create($org(), $r->get_json_params() ?: []));
		}, 'can_write');
		self::route('/lists/(?P<id>[0-9a-f-]{36})', 'GET', function (WP_REST_Request $r) use ($org) {
			$l = NBS_Lists::get($org(), $r->get_url_params()['id']);
			return $l ? ['list' => $l, 'items' => NBS_Lists::items($org(), $r->get_url_params()['id'])] : new WP_Error('nbs_404', 'Listan finns inte.', ['status' => 404]);
		});
		self::route('/lists/(?P<id>[0-9a-f-]{36})', 'PUT', function (WP_REST_Request $r) use ($org) {
			return self::out(NBS_Lists::update($org(), $r->get_url_params()['id'], $r->get_json_params() ?: []));
		}, 'can_write');
		self::route('/lists/(?P<id>[0-9a-f-]{36})', 'DELETE', function (WP_REST_Request $r) use ($org) {
			return self::out(NBS_Lists::delete($org(), $r->get_url_params()['id']));
		}, 'can_manage');

		// ---- Poster i listor
		self::route('/lists/(?P<id>[0-9a-f-]{36})/items', 'POST', function (WP_REST_Request $r) use ($org) {
			return self::out(NBS_Lists::save_item($org(), $r->get_url_params()['id'], $r->get_json_params() ?: []));
		}, 'can_write');
		self::route('/lists/(?P<id>[0-9a-f-]{36})/items/(?P<item>[0-9a-f-]{36})', 'PUT', function (WP_REST_Request $r) use ($org) {
			return self::out(NBS_Lists::save_item($org(), $r->get_url_params()['id'], $r->get_json_params() ?: [], $r->get_url_params()['item']));
		}, 'can_write');
		self::route('/lists/(?P<id>[0-9a-f-]{36})/items/(?P<item>[0-9a-f-]{36})', 'DELETE', function (WP_REST_Request $r) use ($org) {
			return self::out(NBS_Lists::delete_item($org(), $r->get_url_params()['item']));
		}, 'can_write');
		self::route('/lists/(?P<id>[0-9a-f-]{36})/reorder', 'POST', function (WP_REST_Request $r) use ($org) {
			return NBS_Lists::reorder($org(), $r->get_url_params()['id'], (array) $r['ids']);
		}, 'can_write');
		self::route('/refs', 'GET', function () use ($org) {
			return (object) NBS_Lists::ref_options($org());
		});
		self::route('/starter', 'POST', function () use ($org) {
			return ['added' => NBS_Starter::import($org())];
		}, 'can_manage');

		// ---- Ändringslogg
		self::route('/audit', 'GET', function (WP_REST_Request $r) use ($org) {
			global $wpdb;
			$t     = NBS_DB::table('audit');
			$limit = max(1, min(200, (int) ($r['limit'] ?: 50)));
			$where = $wpdb->prepare('org_id = %s', $org());
			if ($r['entity_id'] && NBS_Repo::is_uuid($r['entity_id'])) {
				$where .= $wpdb->prepare(' AND entity_id = %s', $r['entity_id']);
			}
			$rows = $wpdb->get_results("SELECT * FROM $t WHERE $where ORDER BY id DESC LIMIT $limit", ARRAY_A); // phpcs:ignore
			$names = [];
			foreach ($rows as &$row) {
				$uid = (int) $row['user_id'];
				if ($uid && !isset($names[$uid])) {
					$u           = get_userdata($uid);
					$names[$uid] = $u ? $u->display_name : '';
				}
				$row['user']    = $uid ? $names[$uid] : '';
				$row['changes'] = NBS_Repo::unjson($row['changes'], null);
			}
			return $rows;
		});

		// ---- Organisation och medlemmar
		self::route('/org', 'PUT', function (WP_REST_Request $r) use ($org) {
			global $wpdb;
			$name = sanitize_text_field($r['name'] ?? '');
			if ($name === '') {
				return new WP_Error('nbs_name', 'Namnet får inte vara tomt.', ['status' => 400]);
			}
			$wpdb->update(NBS_DB::table('orgs'), ['name' => $name, 'updated_at' => NBS_DB::now()], ['id' => $org()]);
			NBS_Repo::audit('org', $org(), 'update', ['name' => $name]);
			return ['ok' => true, 'name' => $name];
		}, 'can_manage');
		self::route('/org/members', 'GET', function () use ($org) {
			global $wpdb;
			$rows = $wpdb->get_results($wpdb->prepare('SELECT user_id, role, created_at FROM ' . NBS_DB::table('members') . ' WHERE org_id = %s', $org()), ARRAY_A);
			return array_map(function ($m) {
				$u = get_userdata((int) $m['user_id']);
				return ['user_id' => (int) $m['user_id'], 'role' => $m['role'], 'name' => $u ? $u->display_name : '(borttagen)', 'email' => $u ? $u->user_email : ''];
			}, $rows);
		});
		self::route('/org/members', 'POST', [__CLASS__, 'add_member'], 'can_manage');
		self::route('/org/members/(?P<user>\d+)', 'DELETE', function (WP_REST_Request $r) use ($org) {
			global $wpdb;
			$uid = (int) $r->get_url_params()['user'];
			if ($uid === get_current_user_id()) {
				return new WP_Error('nbs_self', 'Du kan inte ta bort dig själv.', ['status' => 400]);
			}
			$wpdb->delete(NBS_DB::table('members'), ['org_id' => $org(), 'user_id' => $uid]);
			NBS_Repo::audit('member', $org(), 'delete', ['user_id' => $uid]);
			return ['ok' => true];
		}, 'can_manage');

		// ---- Export av all data
		self::route('/export', 'GET', function () use ($org) {
			global $wpdb;
			$o   = $org();
			$out = ['exported_at' => gmdate('c'), 'version' => NBS_VERSION, 'org' => NBS_Auth::current()];
			foreach (['lists', 'list_items'] as $t) {
				$out[$t] = $wpdb->get_results($wpdb->prepare('SELECT * FROM ' . NBS_DB::table($t) . ' WHERE org_id = %s', $o), ARRAY_A);
			}
			return $out;
		}, 'can_manage');
	}

	/** Lägger till en befintlig WP-användare (e-post) i organisationen och ger rollen Biodlare. */
	public static function add_member(WP_REST_Request $r) {
		global $wpdb;
		$email = sanitize_email($r['email'] ?? '');
		$role  = array_key_exists($r['role'] ?? '', NBS_Auth::ROLES) ? $r['role'] : 'member';
		if ($role === 'owner' && NBS_Auth::current()['role'] !== 'owner') {
			return new WP_Error('nbs_role', 'Bara ägaren kan lägga till ägare.', ['status' => 403]);
		}
		$user = $email ? get_user_by('email', $email) : null;
		if (!$user) {
			return new WP_Error('nbs_user', 'Det finns ingen användare med den e-postadressen. Skapa användaren i WordPress först.', ['status' => 404]);
		}
		if (!user_can($user, 'nbs_access')) {
			$user->add_role('nbs_biodlare');
		}
		$table = NBS_DB::table('members');
		$org   = NBS_Auth::org_id();
		$wpdb->replace($table, ['org_id' => $org, 'user_id' => $user->ID, 'role' => $role, 'created_at' => NBS_DB::now()]);
		if (!get_user_meta($user->ID, 'nbs_org', true)) {
			update_user_meta($user->ID, 'nbs_org', $org);
		}
		NBS_Repo::audit('member', $org, 'create', ['user_id' => $user->ID, 'role' => $role]);
		return ['ok' => true];
	}
}
