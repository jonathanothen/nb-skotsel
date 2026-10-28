import { useState, useEffect } from '@wordpress/element';
import { api, uuid } from './api';
import { useLoad, Loading, ErrorBox, Button, Modal, useToast } from './ui';
import { FieldInput, formatValue } from './fields';
import FieldDefs, { withIds, cleanFields } from './FieldDefs';
import MapView from './MapView';
import { parseCoords, isShortLink } from './geo';
import { useMe } from './App';
import { useRegister, COLONY_STATUS, QUEEN_STATUS, MATING, COLONY_ACTIVE, label, today, fmtDate } from './register';
import { href } from './router';

/* ------------------------------------------------------------------ Små visningar */

export function QueenBadge( { q, link = true } ) {
	if ( ! q ) {
		return <span className="nbs-muted">Ingen drottning</span>;
	}
	const inner = (
		<>
			<span className="nbs-qdot" style={ { background: q.mark ? q.mark.color : 'transparent' } } title={ q.mark ? `Märkfärg ${ q.mark.name.toLowerCase() }` : 'Ingen märkfärg' } />
			<span>{ q.code }{ q.year ? <span className="nbs-queen-year"> · { q.year }</span> : null }</span>
		</>
	);
	return link ? <a className="nbs-queen" href={ href( 'drottningar/' + q.id ) }>{ inner }</a> : <span className="nbs-queen">{ inner }</span>;
}

export function StatusBadge( { status, kind = 'colony' } ) {
	const pairs = kind === 'queen' ? QUEEN_STATUS : COLONY_STATUS;
	return <span className={ `nbs-status is-${ status }` }>{ label( pairs, status ) }</span>;
}

export function Fill( { n, max } ) {
	if ( ! max ) {
		return <span className="nbs-fill-text">{ n } samhällen</span>;
	}
	const pct = Math.min( 100, Math.round( ( n / max ) * 100 ) );
	return (
		<span className="nbs-fill" title={ `${ n } av ${ max } platser (${ pct } %)` }>
			<span className="nbs-fill-bar"><span style={ { width: pct + '%' } } className={ n > max ? 'is-over' : '' } /></span>
			<span className="nbs-fill-text">{ n }/{ max }</span>
		</span>
	);
}

/** Visar egna fält som en definitionslista. */
export function CustomValues( { fields, data, refs } ) {
	const rows = ( fields || [] ).filter( ( f ) => data && data[ f.key ] !== undefined && data[ f.key ] !== '' );
	if ( ! rows.length ) {
		return null;
	}
	return (
		<dl className="nbs-dl">
			{ rows.map( ( f ) => (
				<div key={ f.key }><dt>{ f.label }</dt><dd>{ f.type === 'url' ? <a href={ data[ f.key ] } target="_blank" rel="noreferrer">{ data[ f.key ] }</a> : formatValue( f, data[ f.key ], refs ) }</dd></div>
			) ) }
		</dl>
	);
}

/* ------------------------------------------------------------------ Formulär */

const ROUTES = { apiary: 'apiaries', hive: 'hives', colony: 'colonies', queen: 'queens' };
export const TYPE_NAMES = { apiary: 'bigård', hive: 'kupa', colony: 'samhälle', queen: 'drottning', plan: 'aktivitet i driftplanen', health: 'bihälsopost', batch: 'honungsparti', delivery: 'leverans', haccp: 'egenkontroll', evaluation: 'bedömning', rearing: 'odlingsserie' };

/** Fasta fält per typ, i samma format som egna fält så att FieldInput kan rita dem. */
function builtIn( type, item ) {
	const ended = item.id && type === 'colony' && ! COLONY_ACTIVE.includes( item.status );
	switch ( type ) {
		case 'apiary':
			return [
				{ key: 'name', label: 'Namn', type: 'text', required: true },
				{ key: 'type_id', label: 'Typ av bigård', type: 'ref', ref: 'bigardstyper' },
				{ key: 'route_id', label: 'Slinga/område', type: 'ref', ref: 'slingor' },
				{ key: 'capacity', label: 'Max antal samhällen', type: 'number', min: 0 },
				{ key: 'code', label: 'Kod/förkortning', type: 'text' },
				{ key: 'registered', label: 'Anmäld till Länsstyrelsen', type: 'date' },
				{ key: 'location', label: 'Adress eller vägbeskrivning', type: 'text' },
				{ key: '_map' },
				{ key: 'notes', label: 'Anteckningar', type: 'textarea' },
				{ key: 'active', label: 'Aktiv', type: 'bool', help: 'Inaktiva bigårdar visas inte i val och på kartan.' },
			];
		case 'hive':
			return [
				{ key: 'label', label: 'Märkning/nummer', type: 'text', required: true },
				{ key: 'system_id', label: 'Kupsystem/kuptyp', type: 'ref', ref: 'kupsystem', help: 'Byt kuptyp med materialet i Kupbyggaren → Lägg ut, så följer lagret med.' },
				{ key: 'apiary_id', label: 'Står i bigård', type: 'ref', ref: '@apiary', help: 'Följer samhället när det flyttas.' },
				{ key: 'notes', label: 'Anteckningar', type: 'textarea' },
				{ key: 'active', label: 'I bruk', type: 'bool', help: 'Kasserade kupor kan inte väljas.' },
			];
		case 'colony':
			return [
				{ key: 'code', label: 'Samhälle (nummer)', type: 'text', required: true },
				{ key: 'status', label: 'Status', type: 'select', noEmpty: true, options: ended ? COLONY_STATUS : COLONY_STATUS.filter( ( s ) => COLONY_ACTIVE.includes( s[ 0 ] ) ), help: ended ? 'Samhället är avslutat. Välj en aktiv status för att återuppliva det.' : 'Död, såld och sammanslagen sätts med åtgärderna på samhällets sida.' },
				{ key: 'apiary_id', label: 'Bigård', type: 'ref', ref: '@apiary' },
				{ key: 'hive_id', label: 'Kupa', type: 'ref', ref: '@hive' },
				{ key: 'queen_id', label: 'Drottning', type: 'ref', ref: '@queen' },
				{ key: 'strength', label: 'Styrka (1–5)', type: 'number', min: 1, max: 5 },
				...( item.id ? [] : [ { key: 'started', label: 'Bildat/registrerat', type: 'date' } ] ),
				{ key: 'notes', label: 'Anteckningar', type: 'textarea' },
			];
		case 'queen':
			return [
				{ key: 'code', label: 'Drottning (id)', type: 'text', required: true },
				{ key: 'year', label: 'Kläckningsår', type: 'number', min: 2000, max: 2100, help: 'Styr märkfärgen.' },
				{ key: 'status', label: 'Status', type: 'select', noEmpty: true, options: QUEEN_STATUS },
				{ key: 'line_id', label: 'Linje/ras', type: 'ref', ref: 'linjer' },
				{ key: 'mother_id', label: 'Mor (larvmor)', type: 'ref', ref: '@queen' },
				{ key: 'mating', label: 'Parning', type: 'select', noEmpty: true, options: MATING },
				{ key: 'mating_place', label: 'Parningsplats', type: 'text' },
				{ key: 'marked', label: 'Märkt', type: 'bool' },
				{ key: 'clipped', label: 'Vingklippt', type: 'bool' },
				{ key: 'notes', label: 'Anteckningar', type: 'textarea' },
			];
	}
	return [];
}

/**
 * Formulär för att skapa eller ändra en post. preset fyller i värden för nya poster
 * (t.ex. bigård när man lägger till ett samhälle från bigårdens sida).
 */
export function EntityForm( { type, item = {}, preset = {}, onClose, onSaved } ) {
	const reg = useRegister();
	const me = useMe();
	const toast = useToast();
	const isNew = ! item.id;
	const fields = builtIn( type, item );
	const custom = reg.fields[ type ] || [];
	const [ form, setForm ] = useState( () => {
		const f = { ...( isNew ? { active: true, status: type === 'queen' ? 'parad' : 'produktion', mating: '', started: today(), year: type === 'queen' ? new Date().getFullYear() : undefined } : item ), ...preset };
		f.data = { ...( item.data || {} ) };
		return f;
	} );
	const [ date, setDate ] = useState( today() );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );
	const set = ( k, v ) => setForm( ( f ) => ( { ...f, [ k ]: v } ) );

	useEffect( () => {
		if ( isNew && type !== 'apiary' && ! preset.code && ! preset.label ) {
			api( 'next-code/' + type ).then( ( r ) => setForm( ( f ) => ( f[ type === 'hive' ? 'label' : 'code' ] ? f : { ...f, [ type === 'hive' ? 'label' : 'code' ]: r.code } ) ) ).catch( () => {} );
		}
	}, [] ); // eslint-disable-line react-hooks/exhaustive-deps

	// Ändringar som blir historik (flytt, drottningbyte, kupbyte, status) får ett datum.
	const historic = type === 'colony' && ! isNew && [ 'apiary_id', 'queen_id', 'hive_id', 'status' ].some( ( k ) => ( form[ k ] || null ) !== ( item[ k ] || null ) );

	const save = async ( e ) => {
		e && e.preventDefault();
		setBusy( true );
		setErr( null );
		const body = {};
		fields.forEach( ( f ) => {
			if ( f.key === '_map' ) {
				body.lat = form.lat ?? null;
				body.lng = form.lng ?? null;
			} else {
				body[ f.key ] = form[ f.key ] ?? null;
			}
		} );
		if ( type === 'apiary' ) {
			body.sort = form.sort ?? null;
		}
		body.data = form.data;
		body.date = historic ? date : form.started || today();
		try {
			const saved = isNew
				? await api( ROUTES[ type ], { method: 'POST', body: { ...body, id: uuid() } } )
				: await api( `${ ROUTES[ type ] }/${ item.id }`, { method: 'PUT', body } );
			await reg.reload();
			toast( isNew ? `${ TYPE_NAMES[ type ][ 0 ].toUpperCase() + TYPE_NAMES[ type ].slice( 1 ) } ${ isNew ? 'lades till' : 'sparades' }.` : 'Ändringen sparades.' );
			onSaved && onSaved( saved );
			onClose();
		} catch ( e2 ) {
			setErr( e2 );
			setBusy( false );
		}
	};

	const remove = async () => {
		if ( ! window.confirm( `Ta bort ${ TYPE_NAMES[ type ] } "${ item.name || item.code || item.label }"? Historiken tas också bort och det går inte att ångra. Vill du bara avsluta posten finns det åtgärder för det i stället.` ) ) {
			return;
		}
		try {
			await api( `${ ROUTES[ type ] }/${ item.id }`, { method: 'DELETE' } );
			await reg.reload();
			toast( 'Posten togs bort.' );
			onClose( true );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};

	return (
		<Modal
			wide={ type === 'apiary' }
			title={ isNew ? `Ny ${ TYPE_NAMES[ type ] }` : `Redigera ${ item.name || item.code || item.label }` }
			onClose={ () => onClose() }
			footer={
				<>
					{ ! isNew && me.can.manage && <Button variant="danger-link" onClick={ remove }>Ta bort</Button> }
					<span className="nbs-spacer" />
					<Button variant="ghost" onClick={ () => onClose() }>Avbryt</Button>
					<Button onClick={ save } disabled={ busy }>{ busy ? 'Sparar…' : 'Spara' }</Button>
				</>
			}
		>
			<form onSubmit={ save } className="nbs-form">
				<ErrorBox error={ err } />
				<div className="nbs-form-grid">
					{ fields.map( ( f ) =>
						f.key === '_map' ? (
							<div className="nbs-field nbs-span-2" key="_map">
								<label htmlFor="nbs-geo-link">Position (GPS)</label>
								<GeoInput onFound={ ( p ) => setForm( ( x ) => ( { ...x, ...p } ) ) } />
								<small className="nbs-help">Klistra in en länk från Google Maps (Dela → Kopiera länk) eller koordinater, använd din position på plats, eller klicka på kartan.</small>
								<MapView height={ 280 } pick={ { lat: form.lat ?? null, lng: form.lng ?? null } } onPick={ ( p ) => setForm( ( x ) => ( { ...x, ...p } ) ) } points={ reg.apiaries.filter( ( a ) => a.id !== item.id && a.active ).map( ( a ) => ( { id: a.id, lat: a.lat, lng: a.lng, label: a.name, color: '#B8AC98' } ) ) } />
								<small className="nbs-help">
									{ form.lat !== null && form.lat !== undefined ? <>{ String( form.lat ).replace( '.', ',' ) }, { String( form.lng ).replace( '.', ',' ) } <button type="button" className="nbs-link-btn" onClick={ () => setForm( ( x ) => ( { ...x, lat: null, lng: null } ) ) }>Ta bort position</button></> : 'Ingen position vald.' }
								</small>
							</div>
						) : (
							<div key={ f.key } className={ f.type === 'textarea' ? 'nbs-span-2' : '' }>
								<FieldInput field={ f } value={ form[ f.key ] } onChange={ ( v ) => set( f.key, v ) } refs={ reg.refs } />
							</div>
						)
					) }
					{ custom.map( ( f ) => (
						<div key={ 'x' + f.key } className={ f.type === 'textarea' ? 'nbs-span-2' : '' }>
							<FieldInput field={ f } value={ form.data[ f.key ] } onChange={ ( v ) => setForm( ( x ) => ( { ...x, data: { ...x.data, [ f.key ]: v } } ) ) } refs={ reg.refs } />
						</div>
					) ) }
				</div>
				{ historic && (
					<div className="nbs-field nbs-historic">
						<label htmlFor="nbs-hist-date">Datum för ändringen</label>
						<input id="nbs-hist-date" type="date" value={ date } onChange={ ( e ) => setDate( e.target.value ) } />
						<small className="nbs-help">Flytt, drottningbyte, kupbyte och statusändring sparas i historiken med det här datumet.</small>
					</div>
				) }
				<button type="submit" hidden />
			</form>
		</Modal>
	);
}

/** Läser en position ur en Google Maps-länk eller koordinater, eller från telefonens GPS. */
function GeoInput( { onFound } ) {
	const [ text, setText ] = useState( '' );
	const [ msg, setMsg ] = useState( null );
	const [ busy, setBusy ] = useState( false );
	const read = async () => {
		setMsg( null );
		let p = parseCoords( text );
		if ( ! p && isShortLink( text ) ) {
			setBusy( true );
			try {
				const r = await api( 'geo/resolve', { method: 'POST', body: { url: text.trim() } } );
				p = parseCoords( r.url );
			} catch ( e ) {
				setMsg( e.message );
			}
			setBusy( false );
		}
		if ( p ) {
			onFound( p );
			setText( '' );
		} else {
			setMsg( ( m ) => m || 'Hittade inga koordinater i texten. Prova att högerklicka på platsen i Google Maps och kopiera koordinaterna (t.ex. 60.18, 17.18).' );
		}
	};
	const gps = () => {
		setMsg( null );
		if ( ! navigator.geolocation ) {
			setMsg( 'Webbläsaren kan inte ge din position.' );
			return;
		}
		setBusy( true );
		navigator.geolocation.getCurrentPosition(
			( pos ) => {
				setBusy( false );
				onFound( { lat: +pos.coords.latitude.toFixed( 6 ), lng: +pos.coords.longitude.toFixed( 6 ) } );
			},
			() => {
				setBusy( false );
				setMsg( 'Positionen kunde inte hämtas. Tillåt platsåtkomst och försök igen.' );
			},
			{ enableHighAccuracy: true, timeout: 15000 }
		);
	};
	return (
		<>
			<div className="nbs-inline-form">
				<input id="nbs-geo-link" type="text" value={ text } onChange={ ( e ) => setText( e.target.value ) } onKeyDown={ ( e ) => e.key === 'Enter' && ( e.preventDefault(), read() ) } placeholder="https://maps.app.goo.gl/… eller 60.18, 17.18" />
				<Button small variant="ghost" onClick={ read } disabled={ busy || ! text.trim() }>Hämta</Button>
				<Button small variant="ghost" onClick={ gps } disabled={ busy }>Använd min position</Button>
			</div>
			{ msg && <small className="nbs-warn">{ msg }</small> }
		</>
	);
}

/* ------------------------------------------------------------------ Egna fält */

export function FieldsModal( { type, onClose, initial, onSaved } ) {
	const reg = useRegister();
	const toast = useToast();
	const [ fields, setFields ] = useState( () => withIds( initial || reg.fields[ type ] ) );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );
	const refLists = [
		...reg.lists.filter( ( l ) => ! l.archived ),
		{ id: '@apiary', key: '@apiary', name: 'Bigårdar (registret)' },
		{ id: '@hive', key: '@hive', name: 'Kupor (registret)' },
		{ id: '@colony', key: '@colony', name: 'Samhällen (registret)' },
		{ id: '@queen', key: '@queen', name: 'Drottningar (registret)' },
	];
	const save = async () => {
		setBusy( true );
		setErr( null );
		try {
			await api( 'fields/' + type, { method: 'PUT', body: { fields: cleanFields( fields ) } } );
			await ( onSaved ? onSaved() : reg.reload() );
			toast( 'Fälten sparades.' );
			onClose();
		} catch ( e ) {
			setErr( e );
			setBusy( false );
		}
	};
	return (
		<Modal
			wide
			title={ `Egna fält för ${ TYPE_NAMES[ type ] }` }
			onClose={ onClose }
			footer={
				<>
					<span className="nbs-spacer" />
					<Button variant="ghost" onClick={ onClose }>Avbryt</Button>
					<Button onClick={ save } disabled={ busy }>{ busy ? 'Sparar…' : 'Spara' }</Button>
				</>
			}
		>
			<div className="nbs-form">
				<ErrorBox error={ err } />
				<p className="nbs-muted">De fasta uppgifterna (som bigård, drottning och status) finns alltid. Här lägger du till egna uppgifter, t.ex. "Ägare av marken", "Avtal t.o.m." eller "Temperament". Fälten syns i formuläret och på postens sida.</p>
				<FieldDefs fields={ fields } setFields={ setFields } refLists={ refLists } />
			</div>
		</Modal>
	);
}

/* ------------------------------------------------------------------ Historik */

const EVENT_TEXT = {
	skapad: 'Registrerades',
	bildad: 'Bildades',
	flytt: 'Flyttades',
	kupbyte: 'Bytte kupa',
	drottning_in: 'Ny drottning',
	drottning_ut: 'Drottning ut',
	delning: 'Delades',
	sammanslagning: 'Slogs ihop',
	forstarkt: 'Förstärktes',
	status: 'Ändrad status',
	avslutad: 'Avslutades',
	anteckning: 'Anteckning',
	besok: 'Besök',
};

function describe( e, reg, ctx ) {
	const ap = ( id ) => ( reg.apiary[ id ] ? reg.apiary[ id ].name : 'okänd bigård' );
	const co = ( id ) => ( reg.colony[ id ] ? <a href={ href( 'samhallen/' + id ) }>{ reg.colony[ id ].code }</a> : 'borttaget samhälle' );
	const qu = ( id ) => ( reg.queen[ id ] ? <QueenBadge q={ reg.queen[ id ] } /> : 'borttagen drottning' );
	const hv = ( id ) => ( id && reg.hive[ id ] ? reg.hive[ id ].label : 'ingen' );
	const st = ( v ) => label( [ ...COLONY_STATUS, ...QUEEN_STATUS ], v );
	const d = e.data || {};
	// I drottningens och bigårdens historik visas vilket samhälle det gäller.
	const which = ctx !== 'colony' && e.colony_id ? <> · samhälle { co( e.colony_id ) }</> : null;
	switch ( e.type ) {
		case 'skapad':
			return e.queen_id && ! e.colony_id ? <>Drottningen registrerades{ e.other_id ? <> · mor { qu( e.other_id ) }</> : null }</> : <>Registrerades i { ap( e.apiary_id ) }{ which }</>;
		case 'bildad':
			return <>Bildades som { st( d.status ).toLowerCase() } ur { co( e.other_id ) }{ which }</>;
		case 'flytt':
			return <>Flyttades från { e.from_id ? ap( e.from_id ) : 'ingen bigård' } till { e.apiary_id ? ap( e.apiary_id ) : 'ingen bigård' }{ which }</>;
		case 'kupbyte':
			return <>Bytte kupa från { hv( d.from ) } till { hv( d.to ) }{ which }</>;
		case 'drottning_in':
			return ctx === 'queen' ? <>Sattes in i samhälle { co( e.colony_id ) }</> : <>Ny drottning: { qu( e.queen_id ) }{ which }</>;
		case 'drottning_ut':
			return ctx === 'queen' ? <>Togs ut ur samhälle { co( e.colony_id ) }{ d.status ? ` · ${ st( d.status ).toLowerCase() }` : '' }{ d.moved ? ' · flyttad' : '' }</> : <>Drottning { qu( e.queen_id ) } togs ut{ d.status ? ` (${ st( d.status ).toLowerCase() })` : '' }{ d.moved ? ' och flyttades' : '' }{ which }</>;
		case 'delning':
			return <>Delades – { st( d.status ).toLowerCase() } { co( e.other_id ) } bildades{ which }</>;
		case 'sammanslagning':
			return <>Slogs ihop med { co( e.other_id ) } och upphörde{ which }</>;
		case 'forstarkt':
			return <>Förstärktes med samhälle { co( e.other_id ) }{ which }</>;
		case 'status':
			return <>Status { st( d.from ).toLowerCase() } → { st( d.to ).toLowerCase() }{ which }</>;
		case 'avslutad':
			return <>{ d.to === 'sald' ? 'Såldes' : 'Dog' }{ which }</>;
		case 'besok':
			return (
				<>
					<a href={ href( 'besok/' + e.other_id ) }><strong>{ d.template || 'Besök' }</strong></a>
					{ d.colonies !== undefined ? ` · ${ d.colonies } samhällen kontrollerade${ d.result === 'action' ? ' · åtgärd krävs' : '' }` : d.summary ? `: ${ d.summary }` : '' }
					{ which }
				</>
			);
		default:
			return <>{ EVENT_TEXT[ e.type ] || e.type }{ which }</>;
	}
}

/** Tidslinje för ett samhälle, en drottning eller en bigård, med anteckningar. */
export function History( { filter, ctx, stamp } ) {
	const reg = useRegister();
	const me = useMe();
	const toast = useToast();
	const qs = Object.entries( filter ).map( ( [ k, v ] ) => `${ k }=${ v }` ).join( '&' );
	const [ events, error, reload ] = useLoad( () => api( 'events?' + qs ), [ qs, stamp ] );
	const [ note, setNote ] = useState( '' );
	const [ date, setDate ] = useState( today() );

	const add = async ( e ) => {
		e.preventDefault();
		try {
			await api( 'events', { method: 'POST', body: { ...filter, note, date, id: uuid() } } );
			setNote( '' );
			reload();
		} catch ( e2 ) {
			toast( e2.message, 'error' );
		}
	};
	const del = async ( id ) => {
		if ( ! window.confirm( 'Ta bort anteckningen?' ) ) {
			return;
		}
		try {
			await api( 'events/' + id, { method: 'DELETE' } );
			reload();
		} catch ( e2 ) {
			toast( e2.message, 'error' );
		}
	};

	return (
		<section className="nbs-card nbs-history">
			<h2 className="nbs-h2">Historik</h2>
			{ me.can.write && (
				<form className="nbs-note-form" onSubmit={ add }>
					<input type="date" value={ date } onChange={ ( e ) => setDate( e.target.value ) } aria-label="Datum" />
					<input type="text" value={ note } onChange={ ( e ) => setNote( e.target.value ) } placeholder="Skriv en anteckning…" aria-label="Anteckning" />
					<Button small type="submit" disabled={ ! note.trim() }>Lägg till</Button>
				</form>
			) }
			<ErrorBox error={ error } />
			{ ! events && ! error && <Loading /> }
			{ events && events.length === 0 && <p className="nbs-muted">Ingen historik ännu.</p> }
			{ events && events.length > 0 && (
				<ol className="nbs-timeline">
					{ events.map( ( e ) => (
						<li key={ e.id } className={ `is-${ e.type }` }>
							<span className="nbs-tl-date">{ fmtDate( e.date ) }</span>
							<div className="nbs-tl-body">
								<div>{ e.type === 'anteckning' ? e.note : describe( e, reg, ctx ) }</div>
								{ e.type !== 'anteckning' && e.note && <div className="nbs-tl-note">{ e.note }</div> }
								<small className="nbs-muted">{ e.user }</small>
								{ e.type === 'anteckning' && me.can.write && <button type="button" className="nbs-link-btn nbs-tl-del" onClick={ () => del( e.id ) }>Ta bort</button> }
							</div>
						</li>
					) ) }
				</ol>
			) }
		</section>
	);
}

/** Gemensam rad med datum och kommentar i åtgärdsdialogerna. */
export function DateNote( { date, setDate, note, setNote } ) {
	return (
		<div className="nbs-form-row">
			<div className="nbs-field">
				<label htmlFor="nbs-op-date">Datum</label>
				<input id="nbs-op-date" type="date" value={ date } onChange={ ( e ) => setDate( e.target.value ) } />
			</div>
			<div className="nbs-field">
				<label htmlFor="nbs-op-note">Kommentar</label>
				<input id="nbs-op-note" type="text" value={ note } onChange={ ( e ) => setNote( e.target.value ) } />
			</div>
		</div>
	);
}

export { useLoad, Loading, ErrorBox, Button, Modal, useToast };
