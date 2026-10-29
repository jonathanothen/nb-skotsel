import { useState } from '@wordpress/element';
import { api } from '../api';
import { href } from '../router';
import { useMe } from '../App';
import { useRegister, today, fmtDate } from '../register';
import { useLoad, Loading, ErrorBox, Button, Empty, useToast } from '../ui';
import { FieldInput } from '../fields';
import { useRecords, useModules, RecordForm, SubTabs, YearSelect, Table, thisYear, fmtNum } from '../records';
import { FieldsModal } from '../reg-ui';
import { useStock, unit, fmtQty } from '../stock';
import VarroaModel from './VarroaModel';

export const HEALTH_TYPES = [ [ 'varroa', 'Varroamätning' ], [ 'behandling', 'Behandling' ], [ 'sjukdom', 'Sjukdomsmisstanke' ], [ 'observation', 'Observation' ] ];
export const VARROA_METHODS = [
	[ 'Naturligt nedfall', 'kvalster/dygn', 3 ],
	[ 'Alkoholtvätt', '% av bina', 3 ],
	[ 'Sockerrullning', '% av bina', 3 ],
	[ 'Drönaryngel', '% angripna celler', 5 ],
];
const H_STATUS = [ [ 'misstanke', 'Misstanke' ], [ 'bekraftad', 'Bekräftad' ], [ 'atgardad', 'Åtgärdad' ], [ 'avskriven', 'Avskriven' ] ];
/**
 * Sjukdomar och skadegörare kommer från grundlistan "sjukdomar" (Listor), där varje post har ett
 * förslag till åtgärdsplan. Grundposterna är bara förslag och kan ändras eller kompletteras.
 */
export const useDiseases = () => useLoad( () => api( 'lists' ).then( ( ls ) => {
	const l = ls.find( ( x ) => x.key === 'sjukdomar' );
	return l ? api( 'lists/' + l.id ).then( ( r ) => r.items.filter( ( i ) => i.active !== false ).map( ( i ) => ( { name: i.name, action: ( i.data && i.data.atgard ) || '', notifiable: !! ( i.data && i.data.anmalningsplikt ) } ) ) ) : [];
} ) );

/** Namnen som val, plus nuvarande värde om det inte finns i listan (äldre poster). */
export const diseaseOptions = ( list, current ) => {
	const names = ( list || [] ).map( ( d ) => d.name );
	return current && ! names.includes( current ) ? [ ...names, current ] : names;
};

const varroaLimit = ( method ) => ( VARROA_METHODS.find( ( m ) => m[ 0 ] === method ) || [ '', '', 3 ] )[ 2 ];
const varroaUnit = ( method ) => ( VARROA_METHODS.find( ( m ) => m[ 0 ] === method ) || [ '', '' ] )[ 1 ];

export function healthText( h, reg ) {
	if ( h.type === 'varroa' ) {
		return `${ h.method || 'Varroa' }: ${ fmtNum( h.value ) } ${ varroaUnit( h.method ) }`;
	}
	if ( h.type === 'behandling' ) {
		return `${ reg.itemName( h.treatment_id ) || 'Behandling' }${ h.round ? `, omgång ${ h.round }` : '' }${ h.value !== null && h.value !== undefined && h.value !== '' ? `, ${ fmtNum( h.value ) } % avdödning` : '' }`;
	}
	if ( h.type === 'sjukdom' ) {
		return `${ h.disease || 'Sjukdom' } – ${ ( H_STATUS.find( ( s ) => s[ 0 ] === h.status ) || [ '', '' ] )[ 1 ].toLowerCase() }`;
	}
	return h.note || 'Observation';
}

export default function Health( { route } ) {
	const reg = useRegister();
	const me = useMe();
	const [ stamp, setStamp ] = useState( 0 );
	const [ modules, , reloadModules ] = useModules();
	const [ fieldsOpen, setFieldsOpen ] = useState( false );
	const tab = route[ 0 ] || 'oversikt';
	if ( reg.error ) {
		return <div className="nbs-page"><ErrorBox error={ reg.error } /></div>;
	}
	if ( reg.loading || ! modules ) {
		return <Loading />;
	}
	const bump = () => setStamp( ( s ) => s + 1 );
	return (
		<div className="nbs-page">
			<header className="nbs-page-head">
				<div>
					<h1 className="nbs-h1">Bihälsa och foder</h1>
					<p className="nbs-muted">Varroamätningar, behandlingar, sjukdomsmisstankar med åtgärdsplan och foder per samhälle.</p>
				</div>
				<div className="nbs-row-actions">
					{ me.can.manage && <Button variant="ghost" onClick={ () => setFieldsOpen( true ) }>Egna fält</Button> }
					{ me.can.write && <a className="nbs-btn is-primary" href={ href( 'bihalsa/registrera' ) }>+ Registrera</a> }
				</div>
			</header>
			<SubTabs label="Bihälsa" current={ tab } tabs={ [ [ 'oversikt', 'Översikt', href( 'bihalsa' ) ], [ 'registrera', 'Registrera', href( 'bihalsa/registrera' ) ], [ 'behandlingar', 'Behandlingar', href( 'bihalsa/behandlingar' ) ], [ 'logg', 'Logg', href( 'bihalsa/logg' ) ], [ 'foder', 'Foder', href( 'bihalsa/foder' ) ], [ 'modell', 'Varroamodell', href( 'bihalsa/modell' ) ] ] } />
			{ tab === 'registrera' && <Register onDone={ bump } /> }
			{ tab === 'logg' && <Log stamp={ stamp } custom={ modules.fields.health || [] } onChanged={ bump } /> }
			{ tab === 'behandlingar' && <PlannedTreatments /> }
			{ tab === 'behandlingar' && <Log key="behandlingar" initialType="behandling" stamp={ stamp } custom={ modules.fields.health || [] } onChanged={ bump } /> }
			{ tab === 'foder' && <Feed target={ modules.settings.feed_target } /> }
			{ tab === 'modell' && <VarroaModel /> }
			{ tab === 'oversikt' && <Overview stamp={ stamp } /> }
			{ fieldsOpen && <FieldsModal type="health" initial={ modules.fields.health || [] } onSaved={ reloadModules } onClose={ () => setFieldsOpen( false ) } /> }
		</div>
	);
}

/* ------------------------------------------------------------------ Översikt */

function Overview( { stamp } ) {
	const reg = useRegister();
	const [ rows, error ] = useRecords( 'health', { since: `${ thisYear() - 1 }-01-01` }, [ stamp ] );
	if ( error ) {
		return <ErrorBox error={ error } />;
	}
	if ( ! rows ) {
		return <Loading />;
	}
	const open = rows.filter( ( h ) => h.type === 'sjukdom' && [ 'misstanke', 'bekraftad' ].includes( h.status ) );
	const latest = ( cid, type ) => rows.find( ( h ) => h.colony_id === cid && h.type === type );
	const aps = reg.apiaries.filter( ( a ) => a.active && reg.coloniesIn( a.id ).length );
	return (
		<>
			{ open.length > 0 && (
				<div className="nbs-alert">
					<strong>Öppna sjukdomsärenden:</strong>
					<ul>{ open.map( ( h ) => <li key={ h.id }><a href={ href( 'samhallen/' + h.colony_id ) }>{ reg.colony[ h.colony_id ] ? 'Samhälle ' + reg.colony[ h.colony_id ].code : 'Samhälle' }</a> · { h.disease } ({ fmtDate( h.rec_date ) }){ h.action && ` – ${ h.action }` }</li> ) }</ul>
				</div>
			) }
			{ aps.length === 0 && <Empty title="Inga samhällen ännu" /> }
			{ aps.map( ( a ) => (
				<section key={ a.id } className="nbs-card nbs-mt">
					<h2 className="nbs-h2">{ a.name }</h2>
					<Table
						rows={ reg.coloniesIn( a.id ).slice().sort( ( x, y ) => String( x.code ).localeCompare( String( y.code ), 'sv', { numeric: true } ) ) }
						cols={ [
							[ 'Samhälle', ( c ) => <a href={ href( 'samhallen/' + c.id ) }>{ c.code }</a> ],
							[ 'Senaste varroa', ( c ) => {
								const v = latest( c.id, 'varroa' );
								return v ? <span className={ v.value > varroaLimit( v.method ) ? 'nbs-warn-inline' : '' }>{ fmtNum( v.value ) } { varroaUnit( v.method ) } <span className="nbs-muted">({ fmtDate( v.rec_date ) })</span></span> : <span className="nbs-muted">–</span>;
							} ],
							[ 'Senaste behandling', ( c ) => {
								const t = latest( c.id, 'behandling' );
								return t ? <>{ healthText( t, reg ) } <span className="nbs-muted">({ fmtDate( t.rec_date ) })</span></> : <span className="nbs-muted">–</span>;
							} ],
						] }
					/>
				</section>
			) ) }
		</>
	);
}

/* ------------------------------------------------------------------ Registrera */

function Register( { onDone } ) {
	const reg = useRegister();
	const toast = useToast();
	const [ stock ] = useStock();
	// Behandlingsmedlen med sina fält (bl.a. kopplad lagerartikel).
	const [ treatList ] = useLoad( () => api( 'lists' ).then( ( ls ) => {
		const l = ls.find( ( x ) => x.key === 'behandling' );
		return l ? api( 'lists/' + l.id ).then( ( r ) => r.items ) : [];
	} ) );
	const [ type, setType ] = useState( 'varroa' );
	const [ date, setDate ] = useState( today() );
	const [ apiary, setApiary ] = useState( '' );
	const [ picked, setPicked ] = useState( null );
	const [ method, setMethod ] = useState( VARROA_METHODS[ 0 ][ 0 ] );
	const [ values, setValues ] = useState( {} );
	const [ treatment, setTreatment ] = useState( '' );
	const [ round, setRound ] = useState( '1' );
	const [ killPct, setKillPct ] = useState( '' );
	const [ item, setItem ] = useState( '' );
	const [ qty, setQty ] = useState( '' );
	const [ from, setFrom ] = useState( '' );
	const [ diseases ] = useDiseases();
	const [ disease, setDisease ] = useState( '' );
	const [ status, setStatus ] = useState( 'misstanke' );
	const [ action, setAction ] = useState( '' );
	const pickDisease = ( name ) => {
		setDisease( name );
		const d = ( diseases || [] ).find( ( x ) => x.name === name );
		setAction( d ? d.action : '' );
	};
	const chosenDisease = ( diseases || [] ).find( ( x ) => x.name === disease );
	const [ note, setNote ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );

	const colonies = reg.activeColonies.filter( ( c ) => ! apiary || c.apiary_id === apiary ).sort( ( a, b ) => String( a.code ).localeCompare( String( b.code ), 'sv', { numeric: true } ) );
	const chosen = ( picked || colonies.map( ( c ) => c.id ) ).filter( ( id ) => colonies.some( ( c ) => c.id === id ) );
	const toggle = ( id ) => setPicked( ( p ) => {
		const cur = p || colonies.map( ( c ) => c.id );
		return cur.includes( id ) ? cur.filter( ( x ) => x !== id ) : [ ...cur, id ];
	} );
	// Behandlingsmedlets lagerartikel (fältet "Lagerartikel" i listan Behandlingsmedel).
	const pickTreatment = ( id ) => {
		setTreatment( id );
		const t = ( treatList || [] ).find( ( x ) => x.id === id );
		if ( t && t.data && t.data.material ) {
			setItem( t.data.material );
		}
		setKillPct( t && t.data && t.data.avdodning !== undefined && t.data.avdodning !== null ? String( t.data.avdodning ) : '' );
	};
	const places = stock && item ? ( stock.bal[ item ] || [] ).filter( ( b ) => b.qty > 0 && b.type !== 'hive' ) : [];

	const run = async () => {
		setBusy( true );
		setErr( null );
		try {
			if ( type === 'varroa' ) {
				const ids = chosen.filter( ( id ) => values[ id ] !== undefined && values[ id ] !== '' );
				if ( ! ids.length ) {
					throw new Error( 'Fyll i värdet för minst ett samhälle.' );
				}
				for ( const id of ids ) {
					await api( 'r/health', { method: 'POST', body: { type, rec_date: date, colony_id: id, apiary_id: reg.colony[ id ].apiary_id, method, value: values[ id ], note } } );
				}
				toast( `${ ids.length } mätningar sparades.` );
			} else {
				const body = { type, rec_date: date, colony_ids: chosen, note };
				if ( type === 'behandling' ) {
					Object.assign( body, { treatment_id: treatment || null, round: round || null, value: killPct === '' ? null : killPct } );
					if ( item && qty && from ) {
						const [ ft, fid ] = from.split( ':' );
						body.stock = { item_id: item, qty, from: { type: ft, id: fid } };
					}
				}
				if ( type === 'sjukdom' ) {
					Object.assign( body, { disease, status, action } );
				}
				const r = await api( 'health/bulk', { method: 'POST', body } );
				toast( `Sparat för ${ r.length } samhällen.` );
			}
			setValues( {} );
			setNote( '' );
			onDone();
		} catch ( e ) {
			setErr( e );
		}
		setBusy( false );
	};

	return (
		<section className="nbs-card">
			<div className="nbs-form">
				<ErrorBox error={ err } />
				<div className="nbs-seg" role="tablist">
					{ HEALTH_TYPES.map( ( [ k, l ] ) => <button key={ k } type="button" role="tab" aria-selected={ type === k } className={ type === k ? 'is-active' : '' } onClick={ () => setType( k ) }>{ l }</button> ) }
				</div>
				<div className="nbs-form-row">
					<div className="nbs-field">
						<label htmlFor="nbs-h-date">Datum</label>
						<input id="nbs-h-date" type="date" value={ date } onChange={ ( e ) => setDate( e.target.value ) } />
					</div>
					<div className="nbs-field">
						<label htmlFor="nbs-h-ap">Bigård</label>
						<select id="nbs-h-ap" value={ apiary } onChange={ ( e ) => ( setApiary( e.target.value ), setPicked( null ) ) }>
							<option value="">Alla bigårdar</option>
							{ reg.apiaries.filter( ( a ) => a.active ).map( ( a ) => <option key={ a.id } value={ a.id }>{ a.name } ({ reg.coloniesIn( a.id ).length })</option> ) }
						</select>
					</div>
				</div>

				{ type === 'varroa' && (
					<>
						<div className="nbs-field">
							<label htmlFor="nbs-h-m">Metod</label>
							<select id="nbs-h-m" value={ method } onChange={ ( e ) => setMethod( e.target.value ) }>
								{ VARROA_METHODS.map( ( m ) => <option key={ m[ 0 ] } value={ m[ 0 ] }>{ m[ 0 ] } ({ m[ 1 ] })</option> ) }
							</select>
							<small className="nbs-help">Över { varroaLimit( method ) } { varroaUnit( method ) } markeras som högt. Justera gränsen efter bihälsoplanen.</small>
						</div>
						<div className="nbs-varroa-grid">
							{ colonies.map( ( c ) => (
								<label key={ c.id } className="nbs-varroa-cell">
									<span>{ c.code }</span>
									<input type="text" inputMode="decimal" value={ values[ c.id ] ?? '' } onChange={ ( e ) => setValues( ( v ) => ( { ...v, [ c.id ]: e.target.value } ) ) } aria-label={ `Samhälle ${ c.code }` } />
								</label>
							) ) }
						</div>
					</>
				) }

				{ type !== 'varroa' && (
					<fieldset className="nbs-checklist">
						<legend>Samhällen ({ chosen.length } av { colonies.length }) <button type="button" className="nbs-link-btn" onClick={ () => setPicked( chosen.length === colonies.length ? [] : null ) }>{ chosen.length === colonies.length ? 'Inga' : 'Alla' }</button></legend>
						{ colonies.map( ( c ) => <label key={ c.id } className={ `nbs-check-pill${ chosen.includes( c.id ) ? ' is-on' : '' }` }><input type="checkbox" checked={ chosen.includes( c.id ) } onChange={ () => toggle( c.id ) } />{ c.code }</label> ) }
					</fieldset>
				) }

				{ type === 'behandling' && (
					<>
						<div className="nbs-form-row">
							<FieldInput field={ { key: 'h_treat', label: 'Behandlingsmedel', type: 'ref', ref: 'behandling' } } value={ treatment } onChange={ pickTreatment } refs={ reg.refs } />
							<FieldInput field={ { key: 'h_round', label: 'Omgång', type: 'number', min: 1 } } value={ round } onChange={ setRound } />
							<FieldInput field={ { key: 'h_kill', label: 'Förväntad avdödning', type: 'number', unit: '%', min: 0, max: 100, help: 'Används i varroamodellen. Förslaget kommer från behandlingsmedlet.' } } value={ killPct } onChange={ setKillPct } />
						</div>
						{ stock && (
							<div className="nbs-subform">
								<p className="nbs-muted">Dra medlet ur lagret (valfritt):</p>
								<div className="nbs-form-row">
									<div className="nbs-field">
										<label htmlFor="nbs-h-item">Lagerartikel</label>
										<select id="nbs-h-item" value={ item } onChange={ ( e ) => setItem( e.target.value ) }>
											<option value="">Inget uttag</option>
											{ stock.items.filter( ( i ) => i.data.kategori === 'Behandling' || i.id === item ).map( ( i ) => <option key={ i.id } value={ i.id }>{ i.name }</option> ) }
										</select>
									</div>
									{ item && <FieldInput field={ { key: 'h_qty', label: `Per samhälle (${ unit( stock.item[ item ] ) })`, type: 'number' } } value={ qty } onChange={ setQty } /> }
									{ item && (
										<div className="nbs-field">
											<label htmlFor="nbs-h-from">Från</label>
											<select id="nbs-h-from" value={ from } onChange={ ( e ) => setFrom( e.target.value ) }>
												<option value="">– Välj –</option>
												{ places.map( ( b ) => <option key={ b.type + b.id } value={ `${ b.type }:${ b.id }` }>{ b.type === 'store' ? stock.store[ b.id ] && stock.store[ b.id ].name : reg.apiary[ b.id ] && reg.apiary[ b.id ].name } ({ fmtQty( b.qty ) })</option> ) }
											</select>
										</div>
									) }
								</div>
							</div>
						) }
					</>
				) }

				{ type === 'sjukdom' && (
					<>
						<div className="nbs-form-row">
							<div className="nbs-field">
								<label htmlFor="nbs-h-dis">Sjukdom</label>
								<select id="nbs-h-dis" value={ disease } onChange={ ( e ) => pickDisease( e.target.value ) }>
									<option value="">Välj…</option>
									{ ( diseases || [] ).map( ( d ) => <option key={ d.name } value={ d.name }>{ d.name }{ d.notifiable ? ' (anmälningspliktig)' : '' }</option> ) }
								</select>
							</div>
							<FieldInput field={ { key: 'h_status', label: 'Status', type: 'select', noEmpty: true, options: H_STATUS } } value={ status } onChange={ setStatus } />
						</div>
						<div className="nbs-field">
							<label htmlFor="nbs-h-act">Åtgärdsplan</label>
							<textarea id="nbs-h-act" rows={ 3 } value={ action } onChange={ ( e ) => setAction( e.target.value ) } />
							{ chosenDisease && chosenDisease.notifiable && <p className="nbs-warn">Anmälningspliktig – kontakta myndigheten innan något flyttas.</p> }
							<small className="nbs-help">Förslaget hämtas från listan <a href={ href( 'listor' ) }>Sjukdomar och skadegörare</a>, där sjukdomarna och åtgärdsförslagen ändras. Stäm av mot bihälsoplanen och bitillsynsmannen.</small>
						</div>
					</>
				) }

				<div className="nbs-field">
					<label htmlFor="nbs-h-note">Anteckning</label>
					<input id="nbs-h-note" type="text" value={ note } onChange={ ( e ) => setNote( e.target.value ) } />
				</div>
				<div className="nbs-row-actions">
					<Button onClick={ run } disabled={ busy || ( type !== 'varroa' && ! chosen.length ) || ( type === 'sjukdom' && ! disease ) }>{ busy ? 'Sparar…' : 'Spara' }</Button>
				</div>
			</div>
		</section>
	);
}

/* ------------------------------------------------------------------ Logg */

export function healthFields( diseases = [], current = '' ) {
	return [
		{ key: 'type', label: 'Typ', type: 'select', noEmpty: true, options: HEALTH_TYPES },
		{ key: 'rec_date', label: 'Datum', type: 'date' },
		{ key: 'colony_id', label: 'Samhälle', type: 'ref', ref: '@colony' },
		{ key: 'method', label: 'Metod', type: 'select', options: VARROA_METHODS.map( ( m ) => m[ 0 ] ), when: ( f ) => f.type === 'varroa' },
		{ key: 'value', label: 'Värde', type: 'number', when: ( f ) => f.type === 'varroa' },
		{ key: 'value', label: 'Förväntad avdödning (%)', type: 'number', when: ( f ) => f.type === 'behandling' },
		{ key: 'treatment_id', label: 'Behandlingsmedel', type: 'ref', ref: 'behandling', when: ( f ) => f.type === 'behandling' },
		{ key: 'round', label: 'Omgång', type: 'number', when: ( f ) => f.type === 'behandling' },
		{ key: 'disease', label: 'Sjukdom', type: 'select', options: diseaseOptions( diseases, current ), when: ( f ) => f.type === 'sjukdom' },
		{ key: 'status', label: 'Status', type: 'select', options: H_STATUS, when: ( f ) => f.type === 'sjukdom' },
		{ key: 'action', label: 'Åtgärdsplan', type: 'textarea', when: ( f ) => f.type === 'sjukdom' },
		{ key: 'note', label: 'Anteckning', type: 'textarea' },
	];
}

function Log( { stamp, custom, onChanged, initialType = '' } ) {
	const reg = useRegister();
	const [ type, setType ] = useState( initialType );
	const [ year, setYear ] = useState( thisYear() );
	const [ rows, error, reload ] = useRecords( 'health', { type, year }, [ stamp ] );
	const [ editing, setEditing ] = useState( null );
	const [ diseases ] = useDiseases();
	return (
		<>
			<div className="nbs-toolbar">
				<YearSelect value={ year } onChange={ setYear } />
				<select value={ type } onChange={ ( e ) => setType( e.target.value ) } aria-label="Typ">
					<option value="">Alla typer</option>
					{ HEALTH_TYPES.map( ( [ k, l ] ) => <option key={ k } value={ k }>{ l }</option> ) }
				</select>
			</div>
			<ErrorBox error={ error } />
			{ ! rows && ! error && <Loading /> }
			{ rows && (
				<Table
					rows={ rows }
					onOpen={ setEditing }
					empty="Inga poster det här året."
					cols={ [
						[ 'Datum', ( h ) => fmtDate( h.rec_date ) ],
						[ 'Typ', ( h ) => ( HEALTH_TYPES.find( ( t ) => t[ 0 ] === h.type ) || [ '', h.type ] )[ 1 ] ],
						[ 'Samhälle', ( h ) => ( reg.colony[ h.colony_id ] ? <a href={ href( 'samhallen/' + h.colony_id ) }>{ reg.colony[ h.colony_id ].code }</a> : '–' ) ],
						[ 'Bigård', ( h ) => ( reg.apiary[ h.apiary_id ] ? reg.apiary[ h.apiary_id ].name : '–' ) ],
						[ 'Uppgift', ( h ) => healthText( h, reg ) ],
					] }
				/>
			) }
			{ editing && <RecordForm type="health" title="Bihälsopost" fields={ healthFields( diseases, editing.disease ) } item={ editing } custom={ custom } onClose={ () => setEditing( null ) } onSaved={ () => ( reload(), onChanged() ) } /> }
		</>
	);
}

/* ------------------------------------------------------------------ Foder */

function Feed( { target } ) {
	const reg = useRegister();
	const [ year, setYear ] = useState( thisYear() );
	const [ feed, error ] = useLoad( () => api( 'feed?year=' + year ), [ year ] );
	if ( error ) {
		return <ErrorBox error={ error } />;
	}
	if ( ! feed ) {
		return <Loading />;
	}
	const col = feed.colonies || {};
	const list = reg.activeColonies.slice().sort( ( a, b ) => String( a.code ).localeCompare( String( b.code ), 'sv', { numeric: true } ) );
	const under = list.filter( ( c ) => ! col[ c.id ] || col[ c.id ].ts < target ).length;
	return (
		<>
			<div className="nbs-toolbar">
				<YearSelect value={ year } onChange={ setYear } />
				<span className="nbs-muted">Mål { target } kg torrsubstans per samhälle (ändras under Inställningar). { under } samhällen under målet.</span>
			</div>
			{ ! Object.keys( feed.items ).length && <p className="nbs-alert">Inga foderartiklar hittades. Koppla fodertyperna till lagerartiklar (listan Fodertyper, fältet Lagerartikel) och ange torrsubstans.</p> }
			<p className="nbs-muted">Räknas från förbrukningen i lagret som är bokad på samhällena (t.ex. via besök med skötselkort eller Fördela i lagret). Torrsubstans från listan Fodertyper.</p>
			<Table
				rows={ list }
				cols={ [
					[ 'Samhälle', ( c ) => <a href={ href( 'samhallen/' + c.id ) }>{ c.code }</a> ],
					[ 'Bigård', ( c ) => ( reg.apiary[ c.apiary_id ] ? reg.apiary[ c.apiary_id ].name : '–' ) ],
					[ 'Foder', ( c ) => ( col[ c.id ] ? `${ fmtNum( col[ c.id ].kg ) } kg` : '–' ), 'is-num' ],
					[ 'Torrsubstans', ( c ) => {
						const ts = col[ c.id ] ? col[ c.id ].ts : 0;
						const pct = Math.min( 100, ( ts / ( target || 1 ) ) * 100 );
						return (
							<span className="nbs-fill">
								<span className="nbs-fill-bar"><span style={ { width: pct + '%' } } className={ ts < target ? 'is-under' : '' } /></span>
								<span className="nbs-fill-text">{ fmtNum( ts ) } kg</span>
							</span>
						);
					} ],
				] }
			/>
		</>
	);
}

/** Bihälsa på samhällets sida: senaste posterna. */
export function ColonyHealth( { colonyId } ) {
	const reg = useRegister();
	const [ rows ] = useRecords( 'health', { colony_id: colonyId, limit: 8 } );
	if ( ! rows || ! rows.length ) {
		return null;
	}
	return (
		<section className="nbs-card nbs-history">
			<div className="nbs-card-head">
				<h2 className="nbs-h2">Bihälsa</h2>
				<a href={ href( 'bihalsa/logg' ) }>Hela loggen</a>
			</div>
			<ul className="nbs-contents">
				{ rows.map( ( h ) => <li key={ h.id }><span className="nbs-muted">{ fmtDate( h.rec_date ) }</span> { healthText( h, reg ) }{ h.note && <em> – { h.note }</em> }</li> ) }
			</ul>
		</section>
	);
}

/**
 * Planerade behandlingar: driftplanens aktiviteter med skötselkort och besök som inte är avslutade.
 * De registreras på samhällena när besöken avslutas.
 */
function PlannedTreatments() {
	const reg = useRegister();
	// Efter invintringen visas nästa års plan.
	const [ year, setYear ] = useState( new Date().getMonth() >= 10 ? thisYear() + 1 : thisYear() );
	const [ rows ] = useLoad( () => api( 'treatments/planned?year=' + year ), [ year ] );
	if ( ! rows ) {
		return null;
	}
	const groups = {};
	rows.forEach( ( r ) => {
		const key = ( r.source === 'plan' ? r.plan_id : r.visit_id ) + ':' + r.treatment_id;
		const g = ( groups[ key ] = groups[ key ] || { ...r, id: key, apiaries: new Set(), colonies: 0 } );
		g.apiaries.add( r.apiary_id );
		g.colonies += r.colony_ids.length;
	} );
	const list = Object.values( groups ).sort( ( a, b ) => ( a.date < b.date ? -1 : 1 ) );
	return (
		<section className="nbs-card">
			<div className="nbs-card-head">
				<h2 className="nbs-h2">Planerade behandlingar</h2>
				<YearSelect value={ year } onChange={ setYear } />
			</div>
			<p className="nbs-muted">Från driftplanens aktiviteter med skötselkort och från besök som inte är avslutade. De registreras på samhällena när besöken avslutas, och syns redan nu i varroamodellen.</p>
			<Table
				rows={ list }
				empty=""
				cols={ [
					[ 'Datum', ( r ) => ( r.source === 'plan' ? fmtDate( r.date ) : <a href={ href( 'besok/' + r.visit_id ) }>{ fmtDate( r.date ) }</a> ) ],
					[ 'Behandling', ( r ) => reg.itemName( r.treatment_id ) + ( r.kill !== null ? `, ${ fmtNum( r.kill ) } %` : '' ) + ( r.broodless ? ' (yngelfritt)' : '' ) ],
					[ 'Källa', ( r ) => ( r.source === 'plan' ? 'Driftplan: ' + r.activity : 'Besök: ' + r.template + ( r.status === 'ongoing' ? ' (pågår)' : '' ) ) ],
					[ 'Bigårdar', ( r ) => ( r.apiaries.size === 1 && reg.apiary[ [ ...r.apiaries ][ 0 ] ] ? reg.apiary[ [ ...r.apiaries ][ 0 ] ].name : r.apiaries.size ) ],
					[ 'Samhällen', ( r ) => r.colonies + ( r.via === 'field' ? ' (om fältet kryssas i)' : '' ) ],
				] }
			/>
		</section>
	);
}
