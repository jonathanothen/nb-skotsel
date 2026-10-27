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

		// ---- Register (fas 1): bigårdar, kupor, samhällen, drottningar
		self::route('/register', 'GET', function () use ($org) {
			NBS_Starter::ensure_system_lists($org());
			return NBS_Entities::register($org());
		});
		$types = ['apiaries' => 'apiary', 'hives' => 'hive', 'colonies' => 'colony', 'queens' => 'queen'];
		foreach ($types as $path => $type) {
			self::route("/$path", 'POST', function (WP_REST_Request $r) use ($org, $type) {
				$body = $r->get_json_params() ?: [];
				return self::out(NBS_Ops::tx(function () use ($org, $type, $body) {
					return NBS_Entities::save($org(), $type, $body, null, ['date' => $body['date'] ?? null]);
				}));
			}, 'can_write');
			self::route("/$path/(?P<id>[0-9a-f-]{36})", 'GET', function (WP_REST_Request $r) use ($org, $type) {
				$row = NBS_Entities::get($org(), $type, $r->get_url_params()['id']);
				return $row ?: new WP_Error('nbs_404', 'Posten finns inte.', ['status' => 404]);
			});
			self::route("/$path/(?P<id>[0-9a-f-]{36})", 'PUT', function (WP_REST_Request $r) use ($org, $type) {
				$body = $r->get_json_params() ?: [];
				$id   = $r->get_url_params()['id'];
				return self::out(NBS_Ops::tx(function () use ($org, $type, $body, $id) {
					return NBS_Entities::save($org(), $type, $body, $id, ['date' => $body['date'] ?? null]);
				}));
			}, 'can_write');
			self::route("/$path/(?P<id>[0-9a-f-]{36})", 'DELETE', function (WP_REST_Request $r) use ($org, $type) {
				$id = $r->get_url_params()['id'];
				return self::out(NBS_Ops::tx(function () use ($org, $type, $id) {
					return NBS_Entities::delete($org(), $type, $id);
				}));
			}, 'can_manage');
		}
		self::route('/fields/(?P<type>apiary|hive|colony|queen)', 'PUT', function (WP_REST_Request $r) use ($org) {
			return self::out(NBS_Entities::save_fields($org(), $r->get_url_params()['type'], (array) ($r['fields'] ?? [])));
		}, 'can_manage');
		self::route('/next-code/(?P<type>hive|colony|queen)', 'GET', function (WP_REST_Request $r) use ($org) {
			return ['code' => NBS_Ops::next_code($org(), $r->get_url_params()['type'])];
		});

		// ---- Operationer på samhällen (skriver historik)
		$op = function ($name, $cb) use ($org) {
			self::route('/colonies/(?P<id>[0-9a-f-]{36})/' . $name, 'POST', function (WP_REST_Request $r) use ($org, $cb) {
				$b    = $r->get_json_params() ?: [];
				$id   = $r->get_url_params()['id'];
				$date = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($b['date'] ?? '')) ? $b['date'] : current_time('Y-m-d');
				$note = sanitize_textarea_field((string) ($b['note'] ?? ''));
				return self::out(NBS_Ops::tx(function () use ($org, $cb, $id, $b, $date, $note) {
					return $cb($org(), $id, $b, $date, $note);
				}));
			}, 'can_write');
		};
		$op('move', function ($o, $id, $b, $date, $note) {
			return NBS_Ops::move($o, $id, $b['apiary_id'] ?? null, $date, $note);
		});
		$op('hive', function ($o, $id, $b, $date, $note) {
			return NBS_Ops::change_hive($o, $id, $b['hive_id'] ?? null, $date, $note);
		});
		$op('queen', function ($o, $id, $b, $date, $note) {
			$queen = $b['queen_id'] ?? null;
			if (!empty($b['new_queen'])) {
				$q = NBS_Ops::new_queen($o, (array) $b['new_queen'], $date);
				if (is_wp_error($q)) {
					return $q;
				}
				$queen = $q['id'];
			}
			return NBS_Ops::set_queen($o, $id, $queen, $date, $b['old_status'] ?? 'ersatt', $note);
		});
		$op('split', function ($o, $id, $b, $date, $note) {
			return NBS_Ops::split($o, $id, $b, $date, $note);
		});
		$op('merge', function ($o, $id, $b, $date, $note) {
			return NBS_Ops::merge($o, $id, $b['into_id'] ?? '', $b['keep'] ?? 'into', $b['other_status'] ?? 'ersatt', $date, $note);
		});
		$op('close', function ($o, $id, $b, $date, $note) {
			return NBS_Ops::close($o, $id, $b['status'] ?? '', $b['queen_status'] ?? '', $date, $note);
		});
		$op('status', function ($o, $id, $b, $date, $note) {
			return NBS_Ops::set_status($o, $id, $b['status'] ?? '', $date, $note);
		});

		// ---- Historik
		self::route('/events', 'GET', function (WP_REST_Request $r) use ($org) {
			$f = [];
			foreach (['colony_id', 'queen_id', 'apiary_id'] as $k) {
				if (NBS_Repo::is_uuid($r[$k])) {
					$f[$k] = $r[$k];
				}
			}
			return $f ? NBS_Events::query($org(), $f, (int) ($r['limit'] ?: 300)) : new WP_Error('nbs_filter', 'Ange samhälle, drottning eller bigård.', ['status' => 400]);
		});
		self::route('/events', 'POST', function (WP_REST_Request $r) use ($org) {
			$b    = $r->get_json_params() ?: [];
			$note = trim(sanitize_textarea_field((string) ($b['note'] ?? '')));
			if ($note === '') {
				return new WP_Error('nbs_note', 'Skriv en anteckning.', ['status' => 400]);
			}
			$refs = ['id' => $b['id'] ?? null];
			foreach (['colony_id', 'queen_id', 'apiary_id'] as $k) {
				$refs[$k] = NBS_Repo::is_uuid($b[$k] ?? '') ? strtolower($b[$k]) : null;
			}
			if (!$refs['colony_id'] && !$refs['queen_id'] && !$refs['apiary_id']) {
				return new WP_Error('nbs_filter', 'Anteckningen måste höra till något.', ['status' => 400]);
			}
			NBS_Events::add($org(), 'anteckning', $refs, $b['date'] ?? null, $note);
			return ['ok' => true];
		}, 'can_write');
		self::route('/events/(?P<id>[0-9a-f-]{36})', 'DELETE', function (WP_REST_Request $r) use ($org) {
			return self::out(NBS_Events::delete($org(), $r->get_url_params()['id']));
		}, 'can_write');
		self::route('/starter/apiaries', 'POST', function () use ($org) {
			return ['added' => NBS_Starter::import_apiaries($org())];
		}, 'can_manage');

		// ---- Lager (fas 2)
		self::route('/stock', 'GET', function () use ($org) {
			return NBS_Stock::overview($org());
		});
		self::route('/stock/tx', 'GET', function (WP_REST_Request $r) use ($org) {
			return NBS_Stock::tx_list($org(), $r->get_query_params(), (int) ($r['limit'] ?: 300));
		});
		foreach (['purchase', 'move', 'consume', 'distribute', 'count'] as $action) {
			self::route('/stock/' . $action, 'POST', function (WP_REST_Request $r) use ($org, $action) {
				$body = $r->get_json_params() ?: [];
				return self::out(NBS_Ops::tx(function () use ($org, $action, $body) {
					return call_user_func(['NBS_Stock', $action], $org(), $body);
				}));
			}, 'can_write');
		}
		self::route('/stock/batch/(?P<id>[0-9a-f-]{36})', 'DELETE', function (WP_REST_Request $r) use ($org) {
			$id = $r->get_url_params()['id'];
			return self::out(NBS_Ops::tx(function () use ($org, $id) {
				return NBS_Stock::undo($org(), $id);
			}));
		}, 'can_write');
		self::route('/stock/rebuild', 'POST', function () use ($org) {
			return self::out(NBS_Ops::tx(function () use ($org) {
				return NBS_Stock::rebuild($org());
			}));
		}, 'can_manage');

		// ---- Kortlänkar från Google Maps (maps.app.goo.gl) → slutadress med koordinater.
		self::route('/geo/resolve', 'POST', [__CLASS__, 'resolve_map_link'], 'can_write');

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
			foreach (['lists', 'list_items', 'apiaries', 'hives', 'colonies', 'queens', 'events', 'stock_tx', 'stock'] as $t) {
				$out[$t] = $wpdb->get_results($wpdb->prepare('SELECT * FROM ' . NBS_DB::table($t) . ' WHERE org_id = %s', $o), ARRAY_A);
			}
			return $out;
		}, 'can_manage');
	}

	/**
	 * Följer omdirigeringarna för en delningslänk från Google Maps och returnerar den
	 * slutliga adressen (som innehåller koordinaterna). Bara Googles egna värdar tillåts,
	 * så att funktionen inte kan användas för att anropa andra adresser.
	 */
	public static function resolve_map_link(WP_REST_Request $r) {
		$url     = esc_url_raw(trim((string) $r['url']));
		$allowed = '/^(maps\.app\.goo\.gl|goo\.gl|(www\.|maps\.)?google\.[a-z.]{2,6})$/i';
		for ($i = 0; $i < 6; $i++) {
			$host = wp_parse_url($url, PHP_URL_HOST);
			if (!$host || !preg_match($allowed, $host) || wp_parse_url($url, PHP_URL_SCHEME) !== 'https') {
				return new WP_Error('nbs_url', 'Det går bara att läsa länkar från Google Maps.', ['status' => 400]);
			}
			if (preg_match('/@-?\d+\.\d+,-?\d+\.\d+|!3d-?\d+\.\d+|[?&](q|query|ll)=-?\d+\.\d+/', rawurldecode($url))) {
				return ['url' => $url];
			}
			$res = wp_safe_remote_get($url, ['redirection' => 0, 'timeout' => 8, 'user-agent' => 'Mozilla/5.0 (compatible; NordiskaBin)']);
			if (is_wp_error($res)) {
				return new WP_Error('nbs_url', 'Länken kunde inte läsas.', ['status' => 400]);
			}
			$next = wp_remote_retrieve_header($res, 'location');
			if (!$next) {
				// Sista sidan: leta efter koordinater i innehållet.
				if (preg_match('/@(-?\d+\.\d+),(-?\d+\.\d+)/', (string) wp_remote_retrieve_body($res), $m)) {
					return ['url' => 'https://www.google.com/maps/@' . $m[1] . ',' . $m[2]];
				}
				return ['url' => $url];
			}
			$url = is_array($next) ? end($next) : $next;
		}
		return ['url' => $url];
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
