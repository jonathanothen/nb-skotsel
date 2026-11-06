<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Kupvågar: enheter, mätvärden, claim, kalibrering, delning per våg och ingest från enheten.
 * Design: se Kupvåg-projektets docs/07-CMS-OCH-OS.md. Vikten räknas ut här från enhetens råvärde
 * och kalibrering (nollvärde, skala, temperaturkoefficient), så en ny kalibrering rättar även
 * gamla mätningar.
 */
class NBS_Devices {

	const LOW_BATTERY_V = 3.5;
	const DROP_G        = 2000;   // viktfall inom 24 h som larmas
	const MAX_SAMPLES   = 500;
	const MAX_BODY      = 65536;

	/* ------------------------------------------------------------ Hjälp */

	private static function t($name) {
		return NBS_DB::table($name);
	}

	/** Normaliserar ett enhets-id (KV-XXXX-XXXX-XXXX, versaler). */
	public static function norm_id($id) {
		return strtoupper(preg_replace('/[^A-Za-z0-9-]/', '', (string) $id));
	}

	public static function default_cal() {
		return ['zero' => null, 'scale' => null, 'tc' => 0.0, 'tref' => 20.0];
	}

	private static function cal($row) {
		return array_merge(self::default_cal(), NBS_Repo::unjson($row['cal'] ?? null));
	}

	/** Vikt i gram från råvärde och kalibrering, eller null om vågen inte är kalibrerad. */
	public static function weight_g($raw, $cal, $t_plate = null) {
		if ($raw === null || $cal['zero'] === null || $cal['scale'] === null) {
			return null;
		}
		$w = ((float) $raw - (float) $cal['zero']) * (float) $cal['scale'];
		if ($t_plate !== null && !empty($cal['tc'])) {
			$w -= (float) $cal['tc'] * ((float) $t_plate - (float) $cal['tref']);
		}
		return (int) round($w);
	}

	private static function get($id) {
		global $wpdb;
		return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::t('devices') . ' WHERE id = %s', self::norm_id($id)), ARRAY_A);
	}

	private static function shared_with_me($id) {
		global $wpdb;
		return (bool) $wpdb->get_var($wpdb->prepare('SELECT 1 FROM ' . self::t('device_shares') . ' WHERE device_id = %s AND user_id = %d', $id, get_current_user_id()));
	}

	/** Hämtar en enhet som den inloggade får se: ['row'=>..., 'mode'=>'org'|'shared'] eller WP_Error. */
	private static function visible($id) {
		$row = self::get($id);
		if ($row) {
			if ($row['org_id'] && $row['org_id'] === NBS_Auth::org_id()) {
				return ['row' => $row, 'mode' => 'org'];
			}
			if (self::shared_with_me($row['id'])) {
				return ['row' => $row, 'mode' => 'shared'];
			}
		}
		return new WP_Error('nbs_404', 'Vågen finns inte.', ['status' => 404]);
	}

	/** Som visible(), men bara för den egna organisationen (ändringar). */
	private static function owned($id) {
		$v = self::visible($id);
		if (is_wp_error($v)) {
			return $v;
		}
		if ($v['mode'] !== 'org') {
			return new WP_Error('nbs_403', 'Vågen är delad med dig och kan bara läsas.', ['status' => 403]);
		}
		return $v['row'];
	}

	private static function latest_rows($id, $n = 1) {
		global $wpdb;
		return $wpdb->get_results($wpdb->prepare('SELECT * FROM ' . self::t('readings') . ' WHERE device_id = %s ORDER BY ts DESC LIMIT %d', $id, $n), ARRAY_A);
	}

	private static function plate_temp($r) {
		if ($r['t_batt'] !== null) {
			return (float) $r['t_batt'];
		}
		return $r['t_out'] !== null ? (float) $r['t_out'] : null;
	}

	private static function point($r, $cal) {
		return [
			'ts'   => str_replace(' ', 'T', $r['ts']) . 'Z',
			'raw'  => $r['raw'] === null ? null : (int) $r['raw'],
			'w'    => self::weight_g($r['raw'] === null ? null : (int) $r['raw'], $cal, self::plate_temp($r)),
			'ti'   => $r['ti'] === null ? null : round((float) $r['ti'], 1),
			'to'   => $r['t_out'] === null ? null : round((float) $r['t_out'], 1),
			'tb'   => $r['t_batt'] === null ? null : round((float) $r['t_batt'], 1),
			'rh'   => $r['rh'] === null ? null : round((float) $r['rh'], 1),
			'snd'  => $r['snd_rms'] === null ? null : round((float) $r['snd_rms'], 4),
			'vb'   => $r['vb'] === null ? null : round((float) $r['vb'], 2),
		];
	}

	/* ------------------------------------------------------------ Läsning */

	private static function summarize($row, $mode) {
		global $wpdb;
		$cal   = self::cal($row);
		$last  = self::latest_rows($row['id'], 1);
		$latest = $last ? self::point($last[0], $cal) : null;

		$trend  = null;
		$alerts = [];
		if ($last && $cal['scale'] !== null) {
			$since = gmdate('Y-m-d H:i:s', strtotime($last[0]['ts'] . ' UTC') - DAY_IN_SECONDS);
			$rs    = $wpdb->get_results($wpdb->prepare('SELECT raw, t_batt, t_out FROM ' . self::t('readings') . ' WHERE device_id = %s AND ts >= %s AND raw IS NOT NULL ORDER BY ts', $row['id'], $since), ARRAY_A);
			if (count($rs) > 1) {
				$ws = [];
				foreach ($rs as $x) {
					$ws[] = self::weight_g((int) $x['raw'], $cal, self::plate_temp($x));
				}
				$trend = end($ws) - $ws[0];
				if (max($ws) - end($ws) >= self::DROP_G) {
					$alerts[] = ['type' => 'viktfall', 'text' => 'Vikten har sjunkit ' . round((max($ws) - end($ws)) / 1000, 1) . ' kg senaste dygnet (svärm eller skörd?).'];
				}
			}
		}
		if ($row['status'] === 'aktiv') {
			$limit = max(3 * HOUR_IN_SECONDS, (int) ($row['interval_s'] ?: 3600) * 2.5);
			$seen  = $row['last_seen'] ? strtotime($row['last_seen'] . ' UTC') : 0;
			if (!$seen || time() - $seen > $limit) {
				$alerts[] = ['type' => 'tyst', 'text' => $seen ? 'Vågen har varit tyst sedan ' . wp_date('j M H:i', $seen) . '.' : 'Vågen har inte hört av sig än.'];
			}
			if ($row['battery_v'] !== null && (float) $row['battery_v'] < self::LOW_BATTERY_V) {
				$alerts[] = ['type' => 'batteri', 'text' => 'Lågt batteri (' . number_format((float) $row['battery_v'], 2, ',', '') . ' V).'];
			}
		}

		$out = [
			'id'         => $row['id'],
			'name'       => $row['name'],
			'status'     => $row['status'],
			'hive_id'    => $mode === 'org' ? $row['hive_id'] : null,
			'apiary_id'  => $mode === 'org' ? $row['apiary_id'] : null,
			'shared'     => $mode === 'shared',
			'dummy'      => (bool) $row['dummy'],
			'fw'         => $row['fw'],
			'last_seen'  => $row['last_seen'] ? str_replace(' ', 'T', $row['last_seen']) . 'Z' : null,
			'battery_v'  => $row['battery_v'] === null ? null : (float) $row['battery_v'],
			'interval_s' => (int) $row['interval_s'],
			'calibrated' => $cal['scale'] !== null,
			'latest'     => $latest,
			'trend_24h_g' => $trend,
			'alerts'     => $alerts,
		];
		if ($mode === 'org') {
			$out['shares'] = self::shares_of($row['id']);
		}
		return $out;
	}

	private static function shares_of($id) {
		global $wpdb;
		$rows = $wpdb->get_results($wpdb->prepare('SELECT user_id FROM ' . self::t('device_shares') . ' WHERE device_id = %s', $id), ARRAY_A);
		$out  = [];
		foreach ($rows as $r) {
			$u = get_userdata((int) $r['user_id']);
			if ($u) {
				$out[] = ['user_id' => (int) $u->ID, 'name' => $u->display_name, 'email' => $u->user_email];
			}
		}
		return $out;
	}

	public static function listing() {
		global $wpdb;
		$org  = NBS_Auth::org_id();
		$t    = self::t('devices');
		$mine = $wpdb->get_results($wpdb->prepare("SELECT * FROM $t WHERE org_id = %s ORDER BY name, id", $org), ARRAY_A); // phpcs:ignore
		$sh   = $wpdb->get_results($wpdb->prepare("SELECT d.* FROM $t d JOIN " . self::t('device_shares') . ' s ON s.device_id = d.id WHERE s.user_id = %d AND (d.org_id IS NULL OR d.org_id <> %s) ORDER BY d.name, d.id', get_current_user_id(), $org), ARRAY_A); // phpcs:ignore
		$out  = [];
		foreach ($mine as $r) {
			$out[] = self::summarize($r, 'org');
		}
		foreach ($sh as $r) {
			$out[] = self::summarize($r, 'shared');
		}
		return $out;
	}

	public static function one($id) {
		$v = self::visible($id);
		return is_wp_error($v) ? $v : self::summarize($v['row'], $v['mode']);
	}

	/** Mätpunkter. res = raw | hour | day | auto (efter spannet). */
	public static function readings($id, $from, $to, $res = 'auto') {
		global $wpdb;
		$v = self::visible($id);
		if (is_wp_error($v)) {
			return $v;
		}
		$row  = $v['row'];
		$cal  = self::cal($row);
		$to_t = $to ? strtotime($to) : time();
		$from_t = $from ? strtotime($from) : $to_t - 7 * DAY_IN_SECONDS;
		if (!$to_t || !$from_t || $from_t >= $to_t) {
			return new WP_Error('nbs_range', 'Ogiltigt tidsintervall.', ['status' => 400]);
		}
		$span = $to_t - $from_t;
		if (!in_array($res, ['raw', 'hour', 'day'], true)) {
			$res = $span <= 3 * DAY_IN_SECONDS ? 'raw' : ($span <= 60 * DAY_IN_SECONDS ? 'hour' : 'day');
		}
		$rows = $wpdb->get_results($wpdb->prepare('SELECT * FROM ' . self::t('readings') . ' WHERE device_id = %s AND ts >= %s AND ts <= %s ORDER BY ts LIMIT 40000', $row['id'], gmdate('Y-m-d H:i:s', $from_t), gmdate('Y-m-d H:i:s', $to_t)), ARRAY_A);
		$pts  = [];
		if ($res === 'raw') {
			foreach ($rows as $r) {
				$pts[] = self::point($r, $cal);
			}
		} else {
			$len = $res === 'hour' ? 3600 : 86400;
			$buckets = [];
			foreach ($rows as $r) {
				$b = (int) floor(strtotime($r['ts'] . ' UTC') / $len) * $len;
				$buckets[$b][] = self::point($r, $cal);
			}
			foreach ($buckets as $b => $list) {
				$avg = function ($k) use ($list) {
					$vals = array_filter(array_column($list, $k), function ($x) {
						return $x !== null;
					});
					return $vals ? round(array_sum($vals) / count($vals), 3) : null;
				};
				$w = $avg('w');
				$pts[] = [
					'ts' => gmdate('Y-m-d\TH:i:s\Z', $b), 'raw' => null, 'w' => $w === null ? null : (int) round($w),
					'ti' => $avg('ti'), 'to' => $avg('to'), 'tb' => $avg('tb'), 'rh' => $avg('rh'), 'snd' => $avg('snd'), 'vb' => $avg('vb'),
				];
			}
		}
		return ['id' => $row['id'], 'res' => $res, 'points' => $pts];
	}

	/** Mätpunkter för enheten som sitter på en kupa. */
	public static function readings_for_hive($hive_id, $from, $to, $res) {
		global $wpdb;
		$id = $wpdb->get_var($wpdb->prepare('SELECT id FROM ' . self::t('devices') . ' WHERE org_id = %s AND hive_id = %s LIMIT 1', NBS_Auth::org_id(), $hive_id));
		return $id ? self::readings($id, $from, $to, $res) : new WP_Error('nbs_404', 'Ingen våg sitter på den kupan.', ['status' => 404]);
	}

	/* ------------------------------------------------------------ Ändringar */

	public static function claim($id, $code) {
		global $wpdb;
		$id  = self::norm_id($id);
		$row = self::get($id);
		// Samma svar oavsett om id:t saknas eller koden är fel, så att id:n inte kan provas fram.
		$bad = new WP_Error('nbs_claim', 'Id eller kod stämmer inte, eller så är vågen redan kopplad.', ['status' => 400]);
		if (!$row || $row['status'] !== 'oclaimad' || !$row['claim_hash']) {
			return $bad;
		}
		$code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) $code));
		if (!password_verify($code, $row['claim_hash'])) {
			return $bad;
		}
		$now = NBS_DB::now();
		$wpdb->update(self::t('devices'), ['org_id' => NBS_Auth::org_id(), 'status' => 'aktiv', 'claimed_at' => $now, 'updated_at' => $now, 'claim_hash' => null], ['id' => $id]);
		NBS_Repo::audit('device', $id, 'create', ['claim' => true]);
		return self::one($id);
	}

	public static function update($id, $body) {
		global $wpdb;
		$row = self::owned($id);
		if (is_wp_error($row)) {
			return $row;
		}
		$set = [];
		if (array_key_exists('name', $body)) {
			$set['name'] = sanitize_text_field((string) $body['name']) ?: null;
		}
		foreach (['hive_id' => 'hives', 'apiary_id' => 'apiaries'] as $f => $type) {
			if (array_key_exists($f, $body)) {
				$val = $body[$f] ?: null;
				if ($val !== null) {
					$ent = NBS_Entities::get(NBS_Auth::org_id(), $type === 'hives' ? 'hive' : 'apiary', (string) $val);
					if (!$ent) {
						return new WP_Error('nbs_ref', 'Kupan eller bigården finns inte.', ['status' => 400]);
					}
				}
				$set[$f] = $val;
			}
		}
		if (array_key_exists('hive_id', $set) && $set['hive_id'] && !array_key_exists('apiary_id', $set)) {
			$h = NBS_Entities::get(NBS_Auth::org_id(), 'hive', $set['hive_id']);
			$set['apiary_id'] = $h['apiary_id'] ?? null;
		}
		if (isset($body['interval_s'])) {
			$set['interval_s'] = max(900, min(86400, (int) $body['interval_s']));
		}
		if ($set) {
			if (!empty($set['hive_id'])) {
				// En kupa har högst en våg.
				$wpdb->query($wpdb->prepare('UPDATE ' . self::t('devices') . ' SET hive_id = NULL WHERE org_id = %s AND hive_id = %s AND id <> %s', NBS_Auth::org_id(), $set['hive_id'], $row['id'])); // phpcs:ignore
			}
			$set['updated_at'] = NBS_DB::now();
			$wpdb->update(self::t('devices'), $set, ['id' => $row['id']]);
			NBS_Repo::audit('device', $row['id'], 'update', $set);
		}
		return self::one($row['id']);
	}

	/** Nollställ (tom våg) eller kalibrera mot en känd vikt, från de senaste råvärdena. */
	public static function calibrate($id, $step, $kg) {
		global $wpdb;
		$row = self::owned($id);
		if (is_wp_error($row)) {
			return $row;
		}
		$cal  = self::cal($row);
		$last = array_filter(self::latest_rows($row['id'], 3), function ($r) {
			return $r['raw'] !== null;
		});
		if (!$last) {
			return new WP_Error('nbs_cal', 'Vågen har inte skickat något råvärde än.', ['status' => 400]);
		}
		$raw = array_sum(array_map('intval', array_column($last, 'raw'))) / count($last);
		if ($step === 'noll') {
			$cal['zero']  = (int) round($raw);
			$cal['scale'] = null;
		} elseif ($step === 'last') {
			$kg = (float) $kg;
			if ($cal['zero'] === null) {
				return new WP_Error('nbs_cal', 'Nollställ först, med tom våg.', ['status' => 400]);
			}
			if ($kg <= 0 || $kg > 300) {
				return new WP_Error('nbs_cal', 'Ange den kända vikten i kilo.', ['status' => 400]);
			}
			$d = $raw - (float) $cal['zero'];
			if (abs($d) < 1000) {
				return new WP_Error('nbs_cal', 'Råvärdet har knappt ändrats sedan nollställningen. Lägg vikten på vågen och vänta på nästa mätning.', ['status' => 400]);
			}
			$cal['scale'] = ($kg * 1000) / $d;
		} else {
			return new WP_Error('nbs_cal', 'Okänt steg.', ['status' => 400]);
		}
		$wpdb->update(self::t('devices'), ['cal' => NBS_Repo::json($cal), 'updated_at' => NBS_DB::now()], ['id' => $row['id']]);
		NBS_Repo::audit('device', $row['id'], 'update', ['calibrate' => $step]);
		return self::one($row['id']);
	}

	/** Tar bort vågen från organisationen; en ny claim-kod skapas och visas en enda gång. */
	public static function release($id) {
		global $wpdb;
		$row = self::owned($id);
		if (is_wp_error($row)) {
			return $row;
		}
		if ($row['dummy']) {
			return self::delete_demo_device($row['id']);
		}
		$code = self::new_claim_code();
		$wpdb->update(self::t('devices'), [
			'org_id' => null, 'hive_id' => null, 'apiary_id' => null, 'name' => null, 'status' => 'oclaimad', 'cal' => null,
			'claim_hash' => password_hash($code, PASSWORD_DEFAULT), 'claimed_at' => null, 'updated_at' => NBS_DB::now(),
		], ['id' => $row['id']]);
		$wpdb->delete(self::t('device_shares'), ['device_id' => $row['id']]);
		NBS_Repo::audit('device', $row['id'], 'delete', ['release' => true]);
		return ['ok' => true, 'claim_code' => self::format_code($code)];
	}

	public static function new_claim_code() {
		$alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // utan tecken som förväxlas
		$code = '';
		for ($i = 0; $i < 12; $i++) {
			$code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
		}
		return $code;
	}

	public static function format_code($code) {
		return implode('-', str_split($code, 4));
	}

	public static function share($id, $email) {
		global $wpdb;
		$row = self::owned($id);
		if (is_wp_error($row)) {
			return $row;
		}
		$user = get_user_by('email', sanitize_email((string) $email));
		if (!$user) {
			return new WP_Error('nbs_user', 'Det finns ingen användare med den e-postadressen i systemet.', ['status' => 404]);
		}
		if (!user_can($user, 'nbs_access')) {
			return new WP_Error('nbs_user', 'Användaren har inte tillgång till Skötsel.', ['status' => 400]);
		}
		if ((int) $user->ID === get_current_user_id()) {
			return new WP_Error('nbs_user', 'Du kan inte dela med dig själv.', ['status' => 400]);
		}
		$wpdb->replace(self::t('device_shares'), ['device_id' => $row['id'], 'user_id' => $user->ID, 'created_at' => NBS_DB::now()]);
		NBS_Repo::audit('device', $row['id'], 'update', ['share' => $user->ID]);
		return self::one($row['id']);
	}

	public static function unshare($id, $user_id) {
		global $wpdb;
		$v = self::visible($id);
		if (is_wp_error($v)) {
			return $v;
		}
		$user_id = (int) $user_id;
		// Ägaren tar bort valfri delning; den som fått delat kan lämna sin egen.
		if ($v['mode'] === 'org') {
			$wpdb->delete(self::t('device_shares'), ['device_id' => $v['row']['id'], 'user_id' => $user_id]);
		} elseif ($user_id === get_current_user_id()) {
			$wpdb->delete(self::t('device_shares'), ['device_id' => $v['row']['id'], 'user_id' => $user_id]);
		} else {
			return new WP_Error('nbs_403', 'Du kan bara lämna din egen delning.', ['status' => 403]);
		}
		return ['ok' => true];
	}

	/** Registrerar en enhet i servern (tillverkningssteget). Bara WP-administratör. Returnerar claim-koden en gång. */
	public static function provision($id, $pubkey, $hw, $fw) {
		global $wpdb;
		$id = self::norm_id($id);
		if (!preg_match('/^KV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/', $id)) {
			return new WP_Error('nbs_id', 'Id ska se ut som KV-XXXX-XXXX-XXXX.', ['status' => 400]);
		}
		if (self::get($id)) {
			return new WP_Error('nbs_dup', 'Id:t finns redan.', ['status' => 409]);
		}
		$pubkey = trim((string) $pubkey);
		if ($pubkey && !openssl_pkey_get_public($pubkey)) {
			return new WP_Error('nbs_key', 'Den publika nyckeln kunde inte läsas (PEM).', ['status' => 400]);
		}
		$code = self::new_claim_code();
		$now  = NBS_DB::now();
		$wpdb->insert(self::t('devices'), [
			'id' => $id, 'status' => 'oclaimad', 'pubkey' => $pubkey ?: null, 'claim_hash' => password_hash($code, PASSWORD_DEFAULT),
			'hw' => sanitize_text_field((string) $hw) ?: null, 'fw' => sanitize_text_field((string) $fw) ?: null,
			'cal' => NBS_Repo::json(self::default_cal()), 'created_at' => $now, 'updated_at' => $now,
		]);
		return ['id' => $id, 'claim_code' => self::format_code($code)];
	}

	/* ------------------------------------------------------------ Ingest (från enheten) */

	/**
	 * Tar emot en klump från enheten. Autentisering: huvudet X-KV-Id och X-KV-Sig (ECDSA P-256, SHA-256,
	 * base64 av DER) över hela kroppen, mot enhetens publika nyckel. Obs: kan inte provas fullt ut förrän
	 * en riktig enhet finns (P3); i övrigt avvisas allt som inte är korrekt signerat.
	 */
	public static function ingest(WP_REST_Request $r) {
		global $wpdb;
		$body = $r->get_body();
		if (strlen($body) === 0 || strlen($body) > self::MAX_BODY) {
			return new WP_Error('nbs_size', 'Fel storlek.', ['status' => 413]);
		}
		$id  = self::norm_id($r->get_header('x_kv_id'));
		$row = $id ? self::get($id) : null;
		$sig = base64_decode((string) $r->get_header('x_kv_sig'), true);
		if (!$row || !$row['pubkey'] || !$sig) {
			return new WP_Error('nbs_auth', 'Avvisad.', ['status' => 401]);
		}
		if (openssl_verify($body, $sig, $row['pubkey'], OPENSSL_ALGO_SHA256) !== 1) {
			return new WP_Error('nbs_auth', 'Avvisad.', ['status' => 401]);
		}
		if ($row['status'] === 'spärrad') {
			return new WP_Error('nbs_blocked', 'Enheten är spärrad.', ['status' => 403]);
		}
		$key = 'nbs_ing_' . md5($id);
		if (get_transient($key)) {
			return new WP_Error('nbs_rate', 'För tätt.', ['status' => 429]);
		}
		set_transient($key, 1, 20);

		$d = json_decode($body, true);
		if (!is_array($d) || ($d['v'] ?? 0) !== 1 || ($d['id'] ?? '') !== $id || !isset($d['seq'], $d['t0'], $d['step']) || !is_array($d['s'] ?? null)) {
			return new WP_Error('nbs_fmt', 'Fel format.', ['status' => 400]);
		}
		if ((int) $d['seq'] <= (int) $row['last_seq']) {
			// Dubblett eller gammal sändning: kvittera utan att spara så att enheten kan rensa sin buffert.
			return self::ingest_reply($row);
		}
		$samples = array_slice($d['s'], 0, self::MAX_SAMPLES);
		$step    = max(1, min(86400, (int) $d['step']));
		$t0      = (int) $d['t0'];
		$num     = function ($a, $k) {
			return isset($a[$k]) && is_numeric($a[$k]) ? (float) $a[$k] : null;
		};
		$net     = is_array($d['net'] ?? null) ? $d['net'] : [];
		$vb_last = null;
		foreach ($samples as $i => $s) {
			if (!is_array($s)) {
				continue;
			}
			$ts  = gmdate('Y-m-d H:i:s', $t0 + $i * $step);
			$snd = is_array($s['snd'] ?? null) ? $s['snd'] : [];
			$bands = is_array($snd['b'] ?? null) ? implode(',', array_map('floatval', array_slice($snd['b'], 0, 8))) : null;
			$vals = [
				'device_id' => $id, 'ts' => $ts,
				'raw' => isset($s['wr']) && is_numeric($s['wr']) ? (int) $s['wr'] : null,
				'ti' => $num($s, 'ti'), 't_out' => $num($s, 'to'), 't_batt' => $num($s, 'tb'),
				'rh' => $num($s, 'rh'), 'rh_out' => $num($s, 'rho'),
				'snd_rms' => $num($snd, 'rms'), 'snd_dom' => isset($snd['dom']) && is_numeric($snd['dom']) ? (int) $snd['dom'] : null, 'snd_bands' => $bands,
				'vb' => $num($s, 'vb'), 'rssi' => isset($net['rssi']) && is_numeric($net['rssi']) ? (int) $net['rssi'] : null,
			];
			// IGNORE: samma tidpunkt två gånger ger ingen dubblett.
			$cols = implode(',', array_keys($vals));
			$ph   = implode(',', array_map(function ($v) {
				return $v === null ? 'NULL' : (is_int($v) ? '%d' : (is_float($v) ? '%f' : '%s'));
			}, $vals));
			$args = array_values(array_filter($vals, function ($v) {
				return $v !== null;
			}));
			$wpdb->query($wpdb->prepare('INSERT IGNORE INTO ' . self::t('readings') . " ($cols) VALUES ($ph)", $args)); // phpcs:ignore
			if ($vals['vb'] !== null) {
				$vb_last = $vals['vb'];
			}
		}
		$skew = isset($d['tn']) && is_numeric($d['tn']) ? (int) $d['tn'] - time() : null;
		$upd  = [
			'last_seq' => (int) $d['seq'], 'last_seen' => NBS_DB::now(), 'updated_at' => NBS_DB::now(),
			'fw' => isset($d['fw']) ? sanitize_text_field((string) $d['fw']) : $row['fw'],
			'hw' => isset($d['hw']) ? sanitize_text_field((string) $d['hw']) : $row['hw'],
		];
		if ($vb_last !== null) {
			$upd['battery_v'] = $vb_last;
		}
		if ($skew !== null) {
			$upd['clock_skew'] = $skew;
		}
		$wpdb->update(self::t('devices'), $upd, ['id' => $id]);
		return self::ingest_reply(self::get($id));
	}

	private static function ingest_reply($row) {
		return ['now' => time(), 'interval' => (int) ($row['interval_s'] ?: 3600), 'ota' => null];
	}

	/* ------------------------------------------------------------ Demodata */

	/** Skapar tre demovågar med 45 dygn mätvärden (eller tar bort dem). Märks "demo" i appen. */
	public static function demo_create() {
		global $wpdb;
		$org = NBS_Auth::org_id();
		if ($wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM ' . self::t('devices') . ' WHERE org_id = %s AND dummy = 1', $org))) {
			return new WP_Error('nbs_demo', 'Demovågarna finns redan. Ta bort dem först.', ['status' => 409]);
		}
		$hives = array_values(array_filter(NBS_Entities::all($org, 'hive'), function ($h) {
			return !empty($h['active']);
		}));
		$plan = [
			['name' => 'Demo: stark kupa',  'kind' => 'bra'],
			['name' => 'Demo: svärmade',    'kind' => 'svarm'],
			['name' => 'Demo: tyst och kall', 'kind' => 'dod'],
		];
		$now_h = (int) floor(time() / 3600) * 3600;
		$days  = 45;
		$tnow  = gmdate('Y-m-d H:i:s');
		foreach ($plan as $i => $p) {
			$id = sprintf('KV-DEMO-%04d-%04d', $i + 1, 1);
			$h  = $hives[$i] ?? null;
			$wpdb->insert(self::t('devices'), [
				'id' => $id, 'org_id' => $org, 'name' => $h ? $p['name'] . ' (' . $h['label'] . ')' : $p['name'],
				'hive_id' => $h['id'] ?? null, 'apiary_id' => $h['apiary_id'] ?? null, 'status' => 'aktiv', 'fw' => 'demo', 'hw' => 'A',
				'cal' => NBS_Repo::json(['zero' => 84000, 'scale' => 0.5, 'tc' => 0.0, 'tref' => 20.0]),
				'dummy' => 1, 'interval_s' => 3600, 'claimed_at' => $tnow, 'created_at' => $tnow, 'updated_at' => $tnow,
			]);
			mt_srand(1000 + $i);
			$base  = 36000 + $i * 5000;
			$cum   = 0.0;
			$rows  = [];
			$last_seen = null;
			$vb_end = null;
			for ($k = 0; $k < $days * 24; $k++) {
				$ts = $now_h - ($days * 24 - 1 - $k) * 3600;
				if ($p['kind'] === 'dod' && $ts > $now_h - 6 * 3600) {
					break; // tyst de senaste timmarna
				}
				$hr  = (int) gmdate('G', $ts) + 2; // ungefär svensk lokaltid
				$day = (int) floor($k / 24);
				$bell = function ($x, $mu, $sd) {
					return exp(-pow(($x - $mu) / $sd, 2) / 2);
				};
				$out = 11 + 5 * sin(($hr - 9) / 24 * 2 * M_PI) + 2.5 * sin($day / 4.5) + (mt_rand(-5, 5) / 10);
				if ($p['kind'] === 'dod') {
					$cum -= 0.4 + mt_rand(0, 4) / 10;                      // långsam förlust av vikt (fukt, rester)
					$ti   = $out + 1.2 + mt_rand(-3, 3) / 10;               // följer utetemperaturen
					$rms  = 0.002 + mt_rand(0, 8) / 10000;
				} else {
					$gain_day = 250 + (($day * 37) % 7) * 120;              // varierande flöde
					if ($hr >= 9 && $hr <= 19) {
						$cum += $gain_day / 11.0 * (0.7 + mt_rand(0, 6) / 10);
					}
					if ($p['kind'] === 'svarm' && $k === $days * 24 - 14) {
						$cum -= 2800;                                        // svärmen lämnar kupan
					}
					$ti  = 34.3 + 0.7 * $bell($hr, 4, 6) + mt_rand(-4, 4) / 10;
					$rms = 0.012 + 0.03 * $bell($hr, 15, 4) + mt_rand(0, 40) / 10000;
				}
				$w = $base + $cum - 550 * $bell($hr, 13, 3) + mt_rand(-20, 20);
				$vb_end = $p['kind'] === 'dod' ? 3.52 - 0.1 * $k / ($days * 24) : 4.05 - 0.012 * $k / 24;
				$rows[] = $wpdb->prepare(
					'(%s,%s,%d,%f,%f,%f,%f,%f,%d,%s,%f,%d)',
					$id, gmdate('Y-m-d H:i:s', $ts), (int) round(84000 + $w / 0.5), round($ti, 1), round($out, 1), round($out + 0.8 * $bell($hr, 14, 3), 1),
					round(55 + 6 * $bell($hr, 5, 5) + mt_rand(-20, 20) / 10, 1), round($rms, 4), 190 + mt_rand(0, 90),
					implode(',', [round($rms * 12, 2), round($rms * 40, 2), round($rms * 55, 2), round($rms * 14, 2)]), round($vb_end, 2), -80 - mt_rand(0, 15)
				);
				$last_seen = gmdate('Y-m-d H:i:s', $ts);
			}
			foreach (array_chunk($rows, 200) as $chunk) {
				$wpdb->query('INSERT IGNORE INTO ' . self::t('readings') . ' (device_id,ts,raw,ti,t_out,t_batt,rh,snd_rms,snd_dom,snd_bands,vb,rssi) VALUES ' . implode(',', $chunk)); // phpcs:ignore
			}
			$wpdb->update(self::t('devices'), ['last_seen' => $last_seen, 'battery_v' => round($vb_end, 2)], ['id' => $id]);
		}
		return self::listing();
	}

	public static function demo_delete() {
		global $wpdb;
		$ids = $wpdb->get_col($wpdb->prepare('SELECT id FROM ' . self::t('devices') . ' WHERE org_id = %s AND dummy = 1', NBS_Auth::org_id()));
		foreach ($ids as $id) {
			self::delete_demo_device($id);
		}
		return ['removed' => count($ids)];
	}

	private static function delete_demo_device($id) {
		global $wpdb;
		$wpdb->delete(self::t('readings'), ['device_id' => $id]);
		$wpdb->delete(self::t('device_shares'), ['device_id' => $id]);
		$wpdb->delete(self::t('devices'), ['id' => $id, 'dummy' => 1]);
		return ['ok' => true];
	}
}
