import { useState } from '@wordpress/element';
import { api } from '../api';
import { href } from '../router';
import { useLoad, Loading, ErrorBox, Button, useToast } from '../ui';
import { useMe } from '../App';
import { makeXlsx, download } from '../xlsx';

const ROLES = { owner: 'Ägare', admin: 'Administratör', member: 'Medlem', viewer: 'Läsare' };
const TABS = [
	[ '', 'Biodlingen' ],
	[ 'medlemmar', 'Medlemmar' ],
	[ 'logg', 'Ändringslogg' ],
	[ 'moduler', 'Moduler' ],
	[ 'export', 'Export' ],
];

export default function Settings( { tab = '' } ) {
	return (
		<div className="nbs-page">
			<h1 className="nbs-h1">Inställningar</h1>
			<div className="nbs-tabs" role="tablist">
				{ TABS.map( ( [ k, l ] ) => (
					<a key={ k } role="tab" aria-selected={ tab === k } className={ `nbs-tab${ tab === k ? ' is-active' : '' }` } href={ href( 'installningar/' + k ) }>{ l }</a>
				) ) }
			</div>
			{ tab === 'medlemmar' && <Members /> }
			{ tab === 'logg' && <Audit /> }
			{ tab === 'moduler' && <Modules /> }
			{ tab === 'export' && <Export /> }
			{ ! tab && <Org /> }
		</div>
	);
}

function Org() {
	const me = useMe();
	const toast = useToast();
	const [ name, setName ] = useState( me.org.name );
	const [ busy, setBusy ] = useState( false );
	const save = async () => {
		setBusy( true );
		try {
			await api( 'org', { method: 'PUT', body: { name } } );
			toast( 'Namnet sparades. Ladda om sidan för att se det i sidhuvudet.' );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
		setBusy( false );
	};
	return (
		<section className="nbs-card nbs-narrow">
			<div className="nbs-field">
				<label htmlFor="nbs-org">Biodlingens namn</label>
				<input id="nbs-org" type="text" value={ name } onChange={ ( e ) => setName( e.target.value ) } disabled={ ! me.can.manage } />
			</div>
			<p className="nbs-muted">Din roll: { ROLES[ me.org.role ] }. Version { me.version }.</p>
			{ me.can.manage && <Button onClick={ save } disabled={ busy || ! name.trim() }>Spara</Button> }
		</section>
	);
}

function Members() {
	const me = useMe();
	const toast = useToast();
	const [ members, error, reload ] = useLoad( () => api( 'org/members' ) );
	const [ email, setEmail ] = useState( '' );
	const [ role, setRole ] = useState( 'member' );
	const add = async ( e ) => {
		e.preventDefault();
		try {
			await api( 'org/members', { method: 'POST', body: { email, role } } );
			setEmail( '' );
			toast( 'Medlemmen lades till.' );
			reload();
		} catch ( e2 ) {
			toast( e2.message, 'error' );
		}
	};
	const remove = async ( m ) => {
		if ( ! window.confirm( `Ta bort ${ m.name } från biodlingen?` ) ) {
			return;
		}
		try {
			await api( 'org/members/' + m.user_id, { method: 'DELETE' } );
			reload();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	if ( error ) {
		return <ErrorBox error={ error } />;
	}
	if ( ! members ) {
		return <Loading />;
	}
	return (
		<section className="nbs-card">
			<table className="nbs-table">
				<thead><tr><th>Namn</th><th>E-post</th><th>Roll</th>{ me.can.manage && <th /> }</tr></thead>
				<tbody>
					{ members.map( ( m ) => (
						<tr key={ m.user_id }>
							<td>{ m.name }</td>
							<td data-label="E-post">{ m.email }</td>
							<td data-label="Roll">{ ROLES[ m.role ] || m.role }</td>
							{ me.can.manage && <td>{ m.user_id !== me.user.id && <Button variant="danger-link" small onClick={ () => remove( m ) }>Ta bort</Button> }</td> }
						</tr>
					) ) }
				</tbody>
			</table>
			{ me.can.manage && (
				<form className="nbs-inline-form" onSubmit={ add }>
					<div className="nbs-field">
						<label htmlFor="nbs-m-email">Lägg till befintlig användare (e-post)</label>
						<input id="nbs-m-email" type="email" value={ email } onChange={ ( e ) => setEmail( e.target.value ) } required />
					</div>
					<div className="nbs-field">
						<label htmlFor="nbs-m-role">Roll</label>
						<select id="nbs-m-role" value={ role } onChange={ ( e ) => setRole( e.target.value ) }>
							{ Object.entries( ROLES ).filter( ( [ k ] ) => k !== 'owner' || me.org.role === 'owner' ).map( ( [ k, l ] ) => <option key={ k } value={ k }>{ l }</option> ) }
						</select>
					</div>
					<Button type="submit">Lägg till</Button>
				</form>
			) }
			<p className="nbs-muted">Användaren måste finnas i WordPress (Användare → Lägg till ny). Läsare kan se allt men inte ändra.</p>
		</section>
	);
}

const ACTIONS = { create: 'skapade', update: 'ändrade', delete: 'tog bort' };
const ENTITIES = { list: 'listan', list_item: 'posten', org: 'biodlingen', member: 'medlem i' };

function Audit() {
	const [ rows, error ] = useLoad( () => api( 'audit?limit=100' ) );
	if ( error ) {
		return <ErrorBox error={ error } />;
	}
	if ( ! rows ) {
		return <Loading />;
	}
	return (
		<section className="nbs-card">
			{ rows.length === 0 && <p className="nbs-muted">Inga ändringar ännu.</p> }
			<ul className="nbs-log">
				{ rows.map( ( r ) => {
					const ch = r.changes || {};
					const what = ch.name ? ( Array.isArray( ch.name ) ? ch.name[ 1 ] : ch.name ) : '';
					const fields = r.action === 'update' ? Object.keys( ch ).filter( ( k ) => k !== 'name' ) : [];
					return (
						<li key={ r.id }>
							<time>{ new Date( r.created_at.replace( ' ', 'T' ) + 'Z' ).toLocaleString( 'sv-SE', { dateStyle: 'short', timeStyle: 'short' } ) }</time>
							<span><strong>{ r.user || 'System' }</strong> { ACTIONS[ r.action ] || r.action } { ENTITIES[ r.entity ] || r.entity } { what && <em>{ what }</em> }{ fields.length > 0 && ` (${ fields.join( ', ' ) })` }</span>
						</li>
					);
				} ) }
			</ul>
		</section>
	);
}

/** Rader ur exporten → läsbara Excel-blad (namn i stället för id). */
function buildSheets( d ) {
	const parse = ( v ) => {
		try {
			return v ? JSON.parse( v ) : {};
		} catch ( e ) {
			return {};
		}
	};
	const by = ( rows, key = 'id' ) => Object.fromEntries( ( rows || [] ).map( ( r ) => [ r[ key ], r ] ) );
	const items = by( d.list_items );
	const lists = by( d.lists );
	const ap = by( d.apiaries );
	const co = by( d.colonies );
	const qu = by( d.queens );
	const hv = by( d.hives );
	const tp = by( d.templates );
	const ba = by( d.batches );
	const nm = ( map, id, k = 'name' ) => ( id && map[ id ] ? map[ id ][ k ] : '' );
	const num = ( v ) => ( v === null || v === undefined || v === '' ? '' : Number( v ) );
	const loc = ( t, id ) => ( t === 'store' ? nm( items, id ) : t === 'apiary' ? nm( ap, id ) : t === 'hive' ? 'Kupa ' + nm( hv, id, 'label' ) : '' );
	const sheets = [];
	const add = ( name, head, rows ) => rows && sheets.push( { name, rows: [ head, ...rows ] } );

	add( 'Bigårdar', [ 'Namn', 'Kod', 'Typ', 'Slinga', 'Max samhällen', 'Latitud', 'Longitud', 'Anmäld', 'Aktiv', 'Anteckningar' ], ( d.apiaries || [] ).map( ( a ) => [ a.name, a.code, nm( items, a.type_id ), nm( items, a.route_id ), num( a.capacity ), num( a.lat ), num( a.lng ), a.registered, a.active === '1' ? 'Ja' : 'Nej', a.notes ] ) );
	add( 'Samhällen', [ 'Samhälle', 'Status', 'Bigård', 'Kupa', 'Drottning', 'Styrka', 'Bildat', 'Avslutat', 'Bildat ur', 'Anteckningar' ], ( d.colonies || [] ).map( ( c ) => [ c.code, c.status, nm( ap, c.apiary_id ), nm( hv, c.hive_id, 'label' ), nm( qu, c.queen_id, 'code' ), num( c.strength ), c.started, c.ended, nm( co, c.parent_id, 'code' ), c.notes ] ) );
	add( 'Drottningar', [ 'Drottning', 'År', 'Status', 'Samhälle', 'Linje', 'Mor', 'Parning', 'Parningsplats', 'Märkt', 'Vingklippt' ], ( d.queens || [] ).map( ( q ) => [ q.code, num( q.year ), q.status, nm( co, q.colony_id, 'code' ), nm( items, q.line_id ), nm( qu, q.mother_id, 'code' ), q.mating, q.mating_place, q.marked === '1' ? 'Ja' : 'Nej', q.clipped === '1' ? 'Ja' : 'Nej' ] ) );
	add( 'Kupor', [ 'Kupa', 'Kupsystem', 'I bruk' ], ( d.hives || [] ).map( ( h ) => [ h.label, nm( items, h.system_id ), h.active === '1' ? 'Ja' : 'Nej' ] ) );
	add( 'Lagersaldo', [ 'Artikel', 'Plats', 'Mängd', 'Enhet' ], ( d.stock || [] ).filter( ( s ) => Number( s.qty ) ).map( ( s ) => [ nm( items, s.item_id ), loc( s.loc_type, s.loc_id ), num( s.qty ), parse( items[ s.item_id ] && items[ s.item_id ].data ).enhet || '' ] ) );
	add( 'Lagerrörelser', [ 'Datum', 'Typ', 'Artikel', 'Mängd', 'Från', 'Till', 'Samhälle', 'Bigård', 'Pris per enhet', 'Kommentar' ], ( d.stock_tx || [] ).map( ( t ) => [ t.tx_date, t.type, nm( items, t.item_id ), num( t.qty ), loc( t.from_type, t.from_id ), loc( t.to_type, t.to_id ), nm( co, t.colony_id, 'code' ), nm( ap, t.apiary_id ), num( t.unit_price ), t.note ] ) );
	add( 'Besök', [ 'Datum', 'Skötselkort', 'Bigård', 'Status', 'Resultat', 'Avvikelse', 'Uppföljning', 'Anteckningar' ], ( d.visits || [] ).map( ( v ) => [ v.visit_date, nm( tp, v.template_id ), nm( ap, v.apiary_id ), v.status, v.result, v.deviation, v.followup === '1' ? v.followup_date || 'Ja' : '', v.notes ] ) );
	// Kupkontrollen: en kolumn per fält som förekommer.
	const keys = [ ...new Set( ( d.inspections || [] ).flatMap( ( i ) => Object.keys( parse( i.data ) ) ) ) ];
	const vis = by( d.visits );
	add( 'Kupkontroll', [ 'Datum', 'Skötselkort', 'Samhälle', 'Kontrollerades inte', ...keys, 'Anteckning' ], ( d.inspections || [] ).map( ( i ) => {
		const v = vis[ i.visit_id ] || {};
		const data = parse( i.data );
		return [ v.visit_date, nm( tp, v.template_id ), nm( co, i.colony_id, 'code' ), i.skipped === '1' ? 'Ja' : '', ...keys.map( ( k ) => ( typeof data[ k ] === 'boolean' ? ( data[ k ] ? 'Ja' : 'Nej' ) : data[ k ] ?? '' ) ), i.note ];
	} ) );
	add( 'Bihälsa', [ 'Datum', 'Typ', 'Samhälle', 'Bigård', 'Metod', 'Värde', 'Behandling', 'Omgång', 'Sjukdom', 'Status', 'Åtgärd', 'Anteckning' ], ( d.health || [] ).map( ( h ) => [ h.rec_date, h.type, nm( co, h.colony_id, 'code' ), nm( ap, h.apiary_id ), h.method, num( h.value ), nm( items, h.treatment_id ), num( h.round ), h.disease, h.status, h.action, h.note ] ) );
	add( 'Partier', [ 'Parti', 'År', 'Bigård', 'Sort', 'Skattad', 'Slungad', 'Kg', 'Vattenhalt %', 'Status' ], ( d.batches || [] ).map( ( b ) => [ b.code, num( b.year ), nm( ap, b.apiary_id ), nm( items, b.sort_id ), b.harvest_date, b.extract_date, num( b.kg ), num( b.water ), b.status ] ) );
	add( 'Tappningar', [ 'Datum', 'Parti', 'Burk (g)', 'Antal', 'Kg', 'Bäst före' ], ( d.fills || [] ).map( ( f ) => [ f.fill_date, nm( ba, f.batch_id, 'code' ), num( f.jar_g ), num( f.jars ), num( f.kg ), f.best_before ] ) );
	add( 'Leveranser', [ 'Datum', 'Parti', 'Kund', 'Burk (g)', 'Antal', 'Kg', 'Anteckning' ], ( d.deliveries || [] ).map( ( l ) => [ l.delivery_date, nm( ba, l.batch_id, 'code' ), nm( items, l.customer_id ) || l.customer, num( l.jar_g ), num( l.jars ), num( l.kg ), l.note ] ) );
	add( 'Egenkontroll', [ 'Datum', 'Typ', 'Område', 'Parti', 'Beskrivning', 'Värde', 'Åtgärd', 'Status' ], ( d.haccp || [] ).map( ( h ) => [ h.rec_date, h.type, h.area, nm( ba, h.batch_id, 'code' ), h.description, num( h.value ), h.action, h.status ] ) );
	add( 'Bedömningar', [ 'Datum', 'Drottning', 'Samhälle', 'Säsong', 'Yngel', 'Styrka', 'Temperament', 'Produktion', 'Rensning', 'Poäng' ], ( d.evaluations || [] ).map( ( e ) => {
		const s = parse( e.scores );
		return [ e.eval_date, nm( qu, e.queen_id, 'code' ), nm( co, e.colony_id, 'code' ), num( e.season ), num( s.yngel ), num( s.styrka ), num( s.temperament ), num( s.produktion ), num( s.rensning ), num( e.total ) ];
	} ) );
	add( 'Budget', [ 'År', 'Kategori', 'Beskrivning', 'Moms %', 'Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec' ], ( d.budget || [] ).map( ( b ) => [ num( b.year ), nm( items, b.account_id ), b.description, num( b.vat ), ...( parse( b.months ).length ? parse( b.months ) : Array( 12 ).fill( '' ) ).map( num ) ] ) );
	add( 'Utfall', [ 'Datum', 'Kategori', 'Beskrivning', 'Belopp exkl. moms', 'Moms %' ], ( d.ledger || [] ).map( ( l ) => [ l.entry_date, nm( items, l.account_id ), l.description, num( l.amount ), num( l.vat ) ] ) );
	add( 'Investeringar', [ 'Investering', 'Månad', 'Belopp exkl. moms', 'Moms %', 'Nyttjandeår' ], ( d.investments || [] ).map( ( i ) => [ i.name, i.month, num( i.amount ), num( i.vat ), num( i.years ) ] ) );
	add( 'Driftplan', [ 'Typ', 'Aktivitet', 'Kategori', 'Startvecka', 'Slutvecka', 'Ansvarig', 'Rutinstatus', 'Skötselkort', 'Kommentar' ], ( d.plan || [] ).map( ( p ) => [ p.kind === 'drag' ? 'Drag' : 'Aktivitet', p.name, nm( items, p.category_id ), num( p.week_start ), num( p.week_end ), p.owner, nm( items, p.status_id ), nm( tp, p.template_id ), p.note ] ) );
	add( 'Listor', [ 'Lista', 'Post', 'Kod', 'Aktiv', 'Uppgifter' ], ( d.list_items || [] ).map( ( i ) => [ nm( lists, i.list_id ), i.name, i.code, i.active === '1' ? 'Ja' : 'Nej', Object.entries( parse( i.data ) ).map( ( [ k, v ] ) => `${ k }: ${ Array.isArray( v ) ? v.join( ', ' ) : items[ v ] ? items[ v ].name : v }` ).join( '; ' ) ] ) );
	return sheets;
}

function Export() {
	const me = useMe();
	const toast = useToast();
	const [ busy, setBusy ] = useState( false );
	const stamp = new Date().toISOString().slice( 0, 10 );
	const json = async () => {
		try {
			const data = await api( 'export' );
			download( new Blob( [ JSON.stringify( data, null, 2 ) ], { type: 'application/json' } ), `skotsel-export-${ stamp }.json` );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	const excel = async () => {
		setBusy( true );
		try {
			const data = await api( 'export' );
			download( makeXlsx( buildSheets( data ) ), `skotsel-${ stamp }.xlsx` );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
		setBusy( false );
	};
	return (
		<section className="nbs-card nbs-narrow">
			<h2 className="nbs-h2">Export</h2>
			<p>Ladda ner all data för biodlingen. <strong>Excel</strong> har ett blad per register (bigårdar, samhällen, drottningar, lager, besök och kupkontroll, bihälsa, honung, ekonomi m.m.) med namn i stället för id. <strong>JSON</strong> är en komplett säkerhetskopia som kan läsas in igen eller flyttas till ett annat system.</p>
			{ me.can.manage ? (
				<div className="nbs-row-actions">
					<Button onClick={ excel } disabled={ busy }>{ busy ? 'Skapar…' : 'Ladda ner Excel' }</Button>
					<Button variant="ghost" onClick={ json }>Ladda ner JSON</Button>
				</div>
			) : <p className="nbs-muted">Bara ägare och administratörer kan exportera.</p> }
		</section>
	);
}

/** Modulinställningar: fodermål (avel och tillväxtplan ändras på sina sidor). */
function Modules() {
	const me = useMe();
	const toast = useToast();
	const [ data, error ] = useLoad( () => api( 'modules' ) );
	const [ target, setTarget ] = useState( null );
	if ( error ) {
		return <ErrorBox error={ error } />;
	}
	if ( ! data ) {
		return <Loading />;
	}
	const value = target ?? data.settings.feed_target;
	const save = async () => {
		try {
			await api( 'modules', { method: 'PUT', body: { feed_target: value } } );
			toast( 'Sparat.' );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	return (
		<section className="nbs-card nbs-narrow">
			<h2 className="nbs-h2">Moduler</h2>
			<div className="nbs-field">
				<label htmlFor="nbs-feed-target">Fodermål per samhälle (kg torrsubstans)</label>
				<input id="nbs-feed-target" type="number" min="0" step="0.5" value={ value } onChange={ ( e ) => setTarget( e.target.value ) } />
				<small className="nbs-help">Används under Bihälsa → Foder. Driftplanen anger cirka 15 kg.</small>
			</div>
			{ me.can.manage && <Button onClick={ save }>Spara</Button> }
			<p className="nbs-muted nbs-mt">Vikterna för avelsbedömningen ändras under Avel, och tillväxtplanen under Ekonomi.</p>
		</section>
	);
}