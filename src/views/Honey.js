import { useState } from '@wordpress/element';
import { api, uuid } from '../api';
import { href, go } from '../router';
import { useMe } from '../App';
import { useRegister, today, fmtDate } from '../register';
import { useLoad, Loading, ErrorBox, Button, Modal, Empty, useToast } from '../ui';
import { FieldInput } from '../fields';
import { useRecords, useModules, RecordForm, SubTabs, YearSelect, Table, thisYear, fmtNum } from '../records';
import { FieldsModal } from '../reg-ui';
import { useStock, fmtQty } from '../stock';

const BATCH_STATUS = [ [ 'skattad', 'Skattad' ], [ 'slungad', 'Slungad' ], [ 'ympad', 'Ympad' ], [ 'tappad', 'Tappad' ], [ 'slut', 'Slut' ] ];
const HACCP_TYPES = [ [ 'kontroll', 'Kontroll' ], [ 'avvikelse', 'Avvikelse' ], [ 'rengoring', 'Rengöring' ], [ 'temperatur', 'Temperatur' ] ];
const AREAS = [ 'Skattning och intag', 'Slungning', 'Silning och klarning', 'Ympning', 'Tappning', 'Lager', 'Rengöring', 'Personal och hygien', 'Skadedjur', 'Transport' ];
const JARS = [ 250, 350, 500, 1000 ];
/** Honung bör ha högst 18 % vattenhalt (gränsvärdet är 20 %). */
const WATER_MAX = 18;
const label = ( pairs, v ) => ( pairs.find( ( p ) => p[ 0 ] === v ) || [ v, v || '–' ] )[ 1 ];

export default function Honey( { route } ) {
	const reg = useRegister();
	const me = useMe();
	const [ modules, , reloadModules ] = useModules();
	const [ fieldsOpen, setFieldsOpen ] = useState( null );
	const [ a, b, c ] = route;
	if ( reg.error ) {
		return <div className="nbs-page"><ErrorBox error={ reg.error } /></div>;
	}
	if ( reg.loading || ! modules ) {
		return <Loading />;
	}
	if ( a === 'parti' && b ) {
		return c === 'aterkallelse' ? <Recall id={ b } /> : <BatchPage key={ b } id={ b } modules={ modules } />;
	}
	const tab = a || 'partier';
	return (
		<div className="nbs-page">
			<header className="nbs-page-head">
				<div>
					<h1 className="nbs-h1">Honung och spårbarhet</h1>
					<p className="nbs-muted">Från skattning till parti, tappning och kund – och tillbaka från en burk till bigården.</p>
				</div>
				<div className="nbs-row-actions">
					{ me.can.manage && <Button variant="ghost" onClick={ () => setFieldsOpen( tab === 'egenkontroll' ? 'haccp' : tab === 'leveranser' ? 'delivery' : 'batch' ) }>Egna fält</Button> }
				</div>
			</header>
			<SubTabs label="Honung" current={ tab } tabs={ [ [ 'partier', 'Partier', href( 'honung' ) ], [ 'leveranser', 'Leveranser', href( 'honung/leveranser' ) ], [ 'egenkontroll', 'Egenkontroll', href( 'honung/egenkontroll' ) ] ] } />
			{ tab === 'partier' && <Batches modules={ modules } /> }
			{ tab === 'leveranser' && <Deliveries /> }
			{ tab === 'egenkontroll' && <Haccp custom={ modules.fields.haccp || [] } /> }
			{ fieldsOpen && <FieldsModal type={ fieldsOpen } initial={ modules.fields[ fieldsOpen ] || [] } onSaved={ reloadModules } onClose={ () => setFieldsOpen( null ) } /> }
		</div>
	);
}

/* ------------------------------------------------------------------ Partier */

function batchFields() {
	return [
		{ key: 'code', label: 'Partikod', type: 'text', required: true, help: 'År–bigård–löpnummer. Föreslås automatiskt.' },
		{ key: 'apiary_id', label: 'Bigård', type: 'ref', ref: '@apiary' },
		{ key: 'harvest_date', label: 'Skattad', type: 'date' },
		{ key: 'sort_id', label: 'Sort', type: 'ref', ref: 'honungssorter' },
		{ key: 'kg', label: 'Mängd', type: 'number', unit: 'kg' },
		{ key: 'water', label: 'Vattenhalt', type: 'number', unit: '%', help: `Bör vara högst ${ WATER_MAX } %.` },
		{ key: 'status', label: 'Status', type: 'select', noEmpty: true, options: BATCH_STATUS },
		{ key: 'extract_date', label: 'Slungad', type: 'date' },
		{ key: 'year', label: 'År', type: 'number' },
		{ key: 'notes', label: 'Anteckningar', type: 'textarea' },
	];
}

function NewBatch( { custom, onClose } ) {
	const reg = useRegister();
	const [ apiary, setApiary ] = useState( '' );
	const [ code, setCode ] = useState( null );
	const pick = async ( id ) => {
		setApiary( id );
		const r = await api( `batch-code?year=${ thisYear() }&apiary_id=${ id }` );
		setCode( r.code );
	};
	if ( ! code ) {
		return (
			<Modal title="Ny skattning" onClose={ onClose }>
				<div className="nbs-form">
					<p className="nbs-muted">Välj bigård – partikoden räknas fram (år–bigård–löpnummer). Honungen från varje bigård hålls åtskild.</p>
					<div className="nbs-field">
						<label htmlFor="nbs-nb-ap">Bigård</label>
						<select id="nbs-nb-ap" value={ apiary } onChange={ ( e ) => pick( e.target.value ) }>
							<option value="">– Välj –</option>
							{ reg.apiaries.filter( ( a ) => a.active ).map( ( a ) => <option key={ a.id } value={ a.id }>{ a.name }</option> ) }
						</select>
					</div>
				</div>
			</Modal>
		);
	}
	return <RecordForm type="batch" wide title="Ny skattning" fields={ batchFields() } preset={ { code, apiary_id: apiary, year: thisYear(), harvest_date: today(), status: 'skattad' } } custom={ custom } onClose={ onClose } onSaved={ ( b ) => b && go( 'honung/parti/' + b.id ) } />;
}

function Batches( { modules } ) {
	const reg = useRegister();
	const me = useMe();
	const [ year, setYear ] = useState( thisYear() );
	const [ creating, setCreating ] = useState( false );
	const [ q, setQ ] = useState( '' );
	const [ rows, error ] = useRecords( 'batch', { year } );
	const [ fills ] = useRecords( 'fill', {} );
	const [ found, setFound ] = useState( null );
	const search = async ( e ) => {
		e.preventDefault();
		const all = await api( 'r/batch?limit=5000' );
		const hit = all.find( ( b ) => b.code.toLowerCase() === q.trim().toLowerCase() );
		setFound( hit || false );
		if ( hit ) {
			go( 'honung/parti/' + hit.id );
		}
	};
	if ( error ) {
		return <ErrorBox error={ error } />;
	}
	if ( ! rows ) {
		return <Loading />;
	}
	const filled = ( id ) => ( fills || [] ).filter( ( f ) => f.batch_id === id ).reduce( ( s, f ) => s + ( f.kg || 0 ), 0 );
	const total = rows.reduce( ( s, b ) => s + ( b.kg || 0 ), 0 );
	return (
		<>
			<div className="nbs-toolbar">
				<YearSelect value={ year } onChange={ setYear } />
				<span className="nbs-muted">{ rows.length } partier · { fmtNum( total ) } kg</span>
				<form className="nbs-inline-form nbs-trace" onSubmit={ search }>
					<input type="search" value={ q } onChange={ ( e ) => setQ( e.target.value ) } placeholder="Spåra burk: partikod" aria-label="Partikod" />
					<Button small type="submit" variant="ghost">Spåra</Button>
				</form>
				<span className="nbs-spacer" />
				{ me.can.write && <Button onClick={ () => setCreating( true ) }>+ Ny skattning</Button> }
			</div>
			{ found === false && <p className="nbs-warn">Hittade inget parti med koden { q }.</p> }
			<Table
				rows={ rows }
				onOpen={ ( b ) => go( 'honung/parti/' + b.id ) }
				empty="Inga partier det här året. Registrera en skattning."
				cols={ [
					[ 'Parti', ( b ) => <a href={ href( 'honung/parti/' + b.id ) }><strong>{ b.code }</strong></a> ],
					[ 'Bigård', ( b ) => ( reg.apiary[ b.apiary_id ] ? reg.apiary[ b.apiary_id ].name : '–' ) ],
					[ 'Sort', ( b ) => reg.itemName( b.sort_id ) || '–' ],
					[ 'Skattad', ( b ) => fmtDate( b.harvest_date ) ],
					[ 'Mängd', ( b ) => ( b.kg ? `${ fmtNum( b.kg ) } kg` : '–' ), 'is-num' ],
					[ 'Vattenhalt', ( b ) => ( b.water ? <span className={ b.water > WATER_MAX ? 'nbs-warn-inline' : '' }>{ fmtNum( b.water ) } %</span> : '–' ), 'is-num' ],
					[ 'Tappat', ( b ) => ( filled( b.id ) ? `${ fmtNum( filled( b.id ) ) } kg` : '–' ), 'is-num' ],
					[ 'Status', ( b ) => <span className={ `nbs-status is-${ b.status }` }>{ label( BATCH_STATUS, b.status ) }</span> ],
				] }
			/>
			{ creating && <NewBatch custom={ modules.fields.batch || [] } onClose={ () => setCreating( false ) } /> }
		</>
	);
}

/* ------------------------------------------------------------------ Ett parti */

function BatchPage( { id, modules } ) {
	const reg = useRegister();
	const me = useMe();
	const [ stamp, setStamp ] = useState( 0 );
	const [ batch, error, reload ] = useLoad( () => api( 'r/batch?limit=5000' ).then( ( r ) => r.find( ( b ) => b.id === id ) || null ), [ id, stamp ] );
	const [ fills ] = useRecords( 'fill', { batch_id: id }, [ stamp ] );
	const [ deliveries ] = useRecords( 'delivery', { batch_id: id }, [ stamp ] );
	const [ dialog, setDialog ] = useState( null );
	const bump = () => setStamp( ( s ) => s + 1 );
	if ( error ) {
		return <div className="nbs-page"><ErrorBox error={ error } /></div>;
	}
	if ( batch === null ) {
		return <div className="nbs-page"><a className="nbs-back" href={ href( 'honung' ) }>← Partier</a><Empty title="Partiet finns inte" /></div>;
	}
	if ( ! batch || ! fills || ! deliveries ) {
		return <Loading />;
	}
	const ap = reg.apiary[ batch.apiary_id ];
	// Saldo per burkstorlek: tappat minus levererat.
	const sizes = {};
	fills.forEach( ( f ) => ( sizes[ f.jar_g ] = { ...( sizes[ f.jar_g ] || { in: 0, out: 0 } ), in: ( sizes[ f.jar_g ] ? sizes[ f.jar_g ].in : 0 ) + ( f.jars || 0 ) } ) );
	deliveries.forEach( ( d ) => ( sizes[ d.jar_g || 0 ] = { ...( sizes[ d.jar_g || 0 ] || { in: 0, out: 0 } ), out: ( sizes[ d.jar_g || 0 ] ? sizes[ d.jar_g || 0 ].out : 0 ) + ( d.jars || 0 ) } ) );
	const filledKg = fills.reduce( ( s, f ) => s + ( f.kg || 0 ), 0 );

	return (
		<div className="nbs-page">
			<a className="nbs-back" href={ href( 'honung' ) }>← Partier</a>
			<header className="nbs-page-head">
				<div>
					<p className="nbs-eyebrow">Honungsparti · { reg.itemName( batch.sort_id ) || 'ingen sort' }</p>
					<h1 className="nbs-h1">{ batch.code } <span className={ `nbs-status is-${ batch.status }` }>{ label( BATCH_STATUS, batch.status ) }</span></h1>
				</div>
				<div className="nbs-row-actions">
					<a className="nbs-btn is-ghost" href={ href( `honung/parti/${ id }/aterkallelse` ) }>Återkallelselista</a>
					{ me.can.write && <Button variant="ghost" onClick={ () => setDialog( 'edit' ) }>Redigera</Button> }
					{ me.can.write && <Button variant="ghost" onClick={ () => setDialog( 'fill' ) }>Tappa</Button> }
					{ me.can.write && <Button onClick={ () => setDialog( 'delivery' ) }>+ Leverans</Button> }
				</div>
			</header>
			<div className="nbs-grid">
				<section className="nbs-card">
					<h2 className="nbs-h2">Spårbarhet</h2>
					<dl className="nbs-dl">
						<div><dt>Bigård</dt><dd>{ ap ? <a href={ href( 'bigardar/' + ap.id ) }>{ ap.name }</a> : '–' }</dd></div>
						<div><dt>Skattad</dt><dd>{ fmtDate( batch.harvest_date ) || '–' }</dd></div>
						<div><dt>Slungad</dt><dd>{ fmtDate( batch.extract_date ) || '–' }</dd></div>
						<div><dt>Mängd</dt><dd>{ batch.kg ? `${ fmtNum( batch.kg ) } kg` : '–' }</dd></div>
						<div><dt>Vattenhalt</dt><dd className={ batch.water > WATER_MAX ? 'nbs-warn-inline' : '' }>{ batch.water ? `${ fmtNum( batch.water ) } %` : '–' }</dd></div>
						<div><dt>Tappat</dt><dd>{ fmtNum( filledKg ) } kg{ batch.kg ? ` av ${ fmtNum( batch.kg ) } kg` : '' }</dd></div>
					</dl>
					{ batch.notes && <p className="nbs-notes">{ batch.notes }</p> }
				</section>
				<section className="nbs-card">
					<h2 className="nbs-h2">Burkar</h2>
					{ Object.keys( sizes ).length ? (
						<Table rows={ Object.entries( sizes ).map( ( [ g, s ] ) => ( { id: g, g, ...s } ) ) } cols={ [ [ 'Storlek', ( r ) => ( r.g > 0 ? `${ r.g } g` : 'Okänd' ) ], [ 'Tappade', ( r ) => r.in, 'is-num' ], [ 'Levererade', ( r ) => r.out, 'is-num' ], [ 'Kvar', ( r ) => <strong>{ r.in - r.out }</strong>, 'is-num' ] ] } />
					) : <p className="nbs-muted">Inget tappat ännu.</p> }
				</section>
			</div>
			<section className="nbs-card nbs-mt">
				<h2 className="nbs-h2">Tappningar</h2>
				<Table rows={ fills } empty="Inga tappningar." cols={ [ [ 'Datum', ( f ) => fmtDate( f.fill_date ) ], [ 'Burkar', ( f ) => `${ f.jars } × ${ f.jar_g } g` ], [ 'Mängd', ( f ) => `${ fmtNum( f.kg ) } kg`, 'is-num' ], [ 'Bäst före', ( f ) => fmtDate( f.best_before ) || '–' ], [ '', ( f ) => me.can.write && <button type="button" className="nbs-link-btn" onClick={ async () => window.confirm( 'Ta bort tappningen? Burkarna läggs tillbaka i lagret.' ) && ( await api( 'r/fill/' + f.id, { method: 'DELETE' } ), bump() ) }>Ta bort</button> ] ] } />
			</section>
			<section className="nbs-card nbs-mt">
				<h2 className="nbs-h2">Leveranser</h2>
				<Table rows={ deliveries } onOpen={ ( d ) => setDialog( d ) } empty="Inga leveranser." cols={ [ [ 'Datum', ( d ) => fmtDate( d.delivery_date ) ], [ 'Kund', ( d ) => reg.itemName( d.customer_id ) || d.customer || '–' ], [ 'Burkar', ( d ) => ( d.jars ? `${ d.jars } × ${ d.jar_g || '?' } g` : '–' ) ], [ 'Mängd', ( d ) => ( d.kg ? `${ fmtNum( d.kg ) } kg` : '–' ), 'is-num' ] ] } />
			</section>
			{ dialog === 'edit' && <RecordForm type="batch" wide title={ batch.code } fields={ batchFields() } item={ batch } custom={ modules.fields.batch || [] } onClose={ () => setDialog( null ) } onSaved={ ( b ) => ( b ? reload() : go( 'honung' ) ) } /> }
			{ dialog === 'fill' && <FillModal batch={ batch } onClose={ () => setDialog( null ) } onDone={ bump } /> }
			{ dialog && ( dialog === 'delivery' || dialog.id ) && (
				<RecordForm
					type="delivery"
					title="Leverans"
					fields={ deliveryFields() }
					item={ dialog.id ? dialog : {} }
					preset={ dialog.id ? {} : { batch_id: id, delivery_date: today(), jar_g: Number( Object.keys( sizes )[ 0 ] ) || 500 } }
					custom={ modules.fields.delivery || [] }
					onClose={ () => setDialog( null ) }
					onSaved={ bump }
				/>
			) }
		</div>
	);
}

function deliveryFields() {
	return [
		{ key: 'delivery_date', label: 'Datum', type: 'date' },
		{ key: 'customer_id', label: 'Kund', type: 'ref', ref: 'kunder', help: 'Kunderna läggs in i listan Kunder.' },
		{ key: 'customer', label: 'Eller kund (fritext)', type: 'text' },
		{ key: 'jar_g', label: 'Burkstorlek', type: 'select', noEmpty: true, options: JARS.map( ( g ) => [ g, `${ g } g` ] ) },
		{ key: 'jars', label: 'Antal burkar', type: 'number', min: 0 },
		{ key: 'kg', label: 'Eller mängd (bulk)', type: 'number', unit: 'kg' },
		{ key: 'note', label: 'Anteckning', type: 'textarea' },
	];
}

function FillModal( { batch, onClose, onDone } ) {
	const toast = useToast();
	const [ stock ] = useStock();
	const [ jarG, setJarG ] = useState( 500 );
	const [ jars, setJars ] = useState( '' );
	const [ date, setDate ] = useState( today() );
	const [ bb, setBb ] = useState( `${ Number( today().slice( 0, 4 ) ) + 2 }-${ today().slice( 5 ) }` );
	const [ product, setProduct ] = useState( '' );
	const [ from, setFrom ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );
	const packs = stock ? stock.items.filter( ( i ) => i.data.kategori === 'Förpackning' ) : [];
	const places = stock && product ? ( stock.bal[ product ] || [] ).filter( ( b ) => b.qty > 0 && b.type === 'store' ) : [];
	const pickSize = ( g ) => {
		setJarG( g );
		const hit = packs.find( ( p ) => p.name.includes( String( g ) ) );
		if ( hit ) {
			setProduct( hit.id );
		}
	};
	const run = async () => {
		setBusy( true );
		setErr( null );
		try {
			const [ ft, fid ] = from.split( ':' );
			await api( 'r/fill', { method: 'POST', body: { id: uuid(), batch_id: batch.id, fill_date: date, jar_g: jarG, jars, best_before: bb, product_id: product || null, from: product && from ? { type: ft, id: fid } : null } } );
			toast( 'Tappningen sparades.' );
			onDone();
			onClose();
		} catch ( e ) {
			setErr( e );
			setBusy( false );
		}
	};
	const kg = ( Number( jars ) || 0 ) * jarG / 1000;
	return (
		<Modal
			title={ `Tappa ${ batch.code }` }
			onClose={ onClose }
			footer={ <><span className="nbs-spacer" /><Button variant="ghost" onClick={ onClose }>Avbryt</Button><Button onClick={ run } disabled={ busy || ! Number( jars ) }>{ busy ? 'Sparar…' : 'Spara' }</Button></> }
		>
			<div className="nbs-form">
				<ErrorBox error={ err } />
				<div className="nbs-field">
					<label>Burkstorlek</label>
					<div className="nbs-scale">{ JARS.map( ( g ) => <button key={ g } type="button" className={ jarG === g ? 'is-on' : '' } onClick={ () => pickSize( g ) }>{ g } g</button> ) }</div>
				</div>
				<div className="nbs-form-row">
					<FieldInput field={ { key: 'f_jars', label: 'Antal burkar', type: 'number', min: 1 } } value={ jars } onChange={ setJars } />
					<FieldInput field={ { key: 'f_date', label: 'Datum', type: 'date' } } value={ date } onChange={ setDate } />
					<FieldInput field={ { key: 'f_bb', label: 'Bäst före', type: 'date' } } value={ bb } onChange={ setBb } />
				</div>
				{ kg > 0 && <p className="nbs-muted">= { fmtNum( kg ) } kg honung{ batch.kg ? ` av partiets ${ fmtNum( batch.kg ) } kg` : '' }.</p> }
				<div className="nbs-subform">
					<p className="nbs-muted">Dra burkarna ur lagret (valfritt):</p>
					<div className="nbs-form-row">
						<div className="nbs-field">
							<label htmlFor="nbs-f-prod">Burk i lagret</label>
							<select id="nbs-f-prod" value={ product } onChange={ ( e ) => setProduct( e.target.value ) }>
								<option value="">Inget uttag</option>
								{ packs.map( ( p ) => <option key={ p.id } value={ p.id }>{ p.name }</option> ) }
							</select>
						</div>
						{ product && (
							<div className="nbs-field">
								<label htmlFor="nbs-f-from">Från</label>
								<select id="nbs-f-from" value={ from } onChange={ ( e ) => setFrom( e.target.value ) }>
									<option value="">– Välj –</option>
									{ places.map( ( b ) => <option key={ b.id } value={ `store:${ b.id }` }>{ stock.store[ b.id ] && stock.store[ b.id ].name } ({ fmtQty( b.qty ) } st)</option> ) }
								</select>
							</div>
						) }
					</div>
				</div>
			</div>
		</Modal>
	);
}

/* ------------------------------------------------------------------ Återkallelse */

function Recall( { id } ) {
	const reg = useRegister();
	const [ batch ] = useLoad( () => api( 'r/batch?limit=5000' ).then( ( r ) => r.find( ( b ) => b.id === id ) ), [ id ] );
	const [ deliveries ] = useRecords( 'delivery', { batch_id: id } );
	const [ customers ] = useLoad( () => api( 'lists' ).then( ( ls ) => {
		const l = ls.find( ( x ) => x.key === 'kunder' );
		return l ? api( 'lists/' + l.id ).then( ( r ) => Object.fromEntries( r.items.map( ( i ) => [ i.id, i ] ) ) ) : {};
	} ) );
	if ( ! batch || ! deliveries || ! customers ) {
		return <Loading />;
	}
	return (
		<div className="nbs-page nbs-print-page">
			<div className="nbs-print-tools">
				<a className="nbs-back" href={ href( 'honung/parti/' + id ) }>← Partiet</a>
				<Button onClick={ () => window.print() }>Skriv ut</Button>
			</div>
			<article className="nbs-sheet">
				<header className="nbs-sheet-head">
					<h1>Återkallelselista – parti { batch.code }</h1>
					<p>{ reg.apiary[ batch.apiary_id ] ? reg.apiary[ batch.apiary_id ].name : '' } · skattad { fmtDate( batch.harvest_date ) } · { reg.itemName( batch.sort_id ) } · utskriven { today() }</p>
				</header>
				<table className="nbs-sheet-table">
					<thead><tr><th>Datum</th><th>Kund</th><th>Kontakt</th><th>Telefon / e-post</th><th>Burkar</th><th>Kontaktad</th></tr></thead>
					<tbody>
						{ deliveries.map( ( d ) => {
							const c = customers[ d.customer_id ];
							return (
								<tr key={ d.id }>
									<td>{ fmtDate( d.delivery_date ) }</td>
									<td>{ c ? c.name : d.customer }</td>
									<td>{ c && c.data.kontakt }</td>
									<td>{ c && [ c.data.telefon, c.data.epost ].filter( Boolean ).join( ' · ' ) }</td>
									<td>{ d.jars ? `${ d.jars } × ${ d.jar_g } g` : d.kg ? `${ fmtNum( d.kg ) } kg` : '' }</td>
									<td>□</td>
								</tr>
							);
						} ) }
						{ ! deliveries.length && <tr><td colSpan={ 6 }>Inga leveranser registrerade för partiet.</td></tr> }
					</tbody>
				</table>
			</article>
		</div>
	);
}

/* ------------------------------------------------------------------ Leveranser och egenkontroll */

function Deliveries() {
	const reg = useRegister();
	const [ year, setYear ] = useState( thisYear() );
	const [ rows, error ] = useRecords( 'delivery', { year } );
	const [ batches ] = useRecords( 'batch', { limit: 5000 } );
	const code = Object.fromEntries( ( batches || [] ).map( ( b ) => [ b.id, b.code ] ) );
	return (
		<>
			<div className="nbs-toolbar"><YearSelect value={ year } onChange={ setYear } /></div>
			<ErrorBox error={ error } />
			{ ! rows ? <Loading /> : (
				<Table
					rows={ rows }
					empty="Inga leveranser det här året. Leveranser registreras på partiet."
					cols={ [
						[ 'Datum', ( d ) => fmtDate( d.delivery_date ) ],
						[ 'Kund', ( d ) => reg.itemName( d.customer_id ) || d.customer || '–' ],
						[ 'Parti', ( d ) => <a href={ href( 'honung/parti/' + d.batch_id ) }>{ code[ d.batch_id ] || '–' }</a> ],
						[ 'Burkar', ( d ) => ( d.jars ? `${ d.jars } × ${ d.jar_g } g` : '–' ) ],
						[ 'Mängd', ( d ) => ( d.kg ? `${ fmtNum( d.kg ) } kg` : d.jars ? `${ fmtNum( d.jars * d.jar_g / 1000 ) } kg` : '–' ), 'is-num' ],
					] }
				/>
			) }
		</>
	);
}

function Haccp( { custom } ) {
	const me = useMe();
	const [ year, setYear ] = useState( thisYear() );
	const [ rows, error, reload ] = useRecords( 'haccp', { year } );
	const [ batches ] = useRecords( 'batch', { limit: 5000 } );
	const [ editing, setEditing ] = useState( null );
	const fields = [
		{ key: 'rec_date', label: 'Datum', type: 'date' },
		{ key: 'type', label: 'Typ', type: 'select', noEmpty: true, options: HACCP_TYPES },
		{ key: 'area', label: 'Område', type: 'select', options: AREAS },
		{ key: 'batch_id', label: 'Parti', type: 'select', options: ( batches || [] ).map( ( b ) => [ b.id, b.code ] ) },
		{ key: 'description', label: 'Beskrivning', type: 'text', required: true, wide: true },
		{ key: 'value', label: 'Mätvärde', type: 'number', help: 'T.ex. temperatur i °C', when: ( f ) => f.type === 'temperatur' || f.type === 'kontroll' },
		{ key: 'action', label: 'Åtgärd', type: 'textarea', when: ( f ) => f.type === 'avvikelse' },
		{ key: 'status', label: 'Status', type: 'select', options: [ [ 'oppen', 'Öppen' ], [ 'stangd', 'Åtgärdad' ] ], when: ( f ) => f.type === 'avvikelse' },
	];
	const open = ( rows || [] ).filter( ( h ) => h.type === 'avvikelse' && h.status !== 'stangd' );
	return (
		<>
			<div className="nbs-toolbar">
				<YearSelect value={ year } onChange={ setYear } />
				<span className="nbs-muted">Egenkontroll enligt HACCP-planen: kontroller, rengöring, temperaturer och avvikelser.</span>
				<span className="nbs-spacer" />
				{ me.can.write && <Button onClick={ () => setEditing( { rec_date: today(), type: 'kontroll' } ) }>+ Ny post</Button> }
			</div>
			{ open.length > 0 && <div className="nbs-alert"><strong>{ open.length } öppna avvikelser.</strong> { open.map( ( h ) => h.description ).join( ' · ' ) }</div> }
			<ErrorBox error={ error } />
			{ ! rows ? <Loading /> : (
				<Table
					rows={ rows }
					onOpen={ setEditing }
					empty="Inga poster det här året."
					cols={ [
						[ 'Datum', ( h ) => fmtDate( h.rec_date ) ],
						[ 'Typ', ( h ) => label( HACCP_TYPES, h.type ) ],
						[ 'Område', ( h ) => h.area || '–' ],
						[ 'Beskrivning', ( h ) => <>{ h.description }{ h.value !== null && h.value !== undefined && <span className="nbs-muted"> · { fmtNum( h.value ) }</span> }</> ],
						[ 'Status', ( h ) => ( h.type === 'avvikelse' ? <span className={ `nbs-status is-${ h.status === 'stangd' ? 'parad' : 'dod' }` }>{ h.status === 'stangd' ? 'Åtgärdad' : 'Öppen' }</span> : '' ) ],
					] }
				/>
			) }
			{ editing && <RecordForm type="haccp" title="Egenkontroll" fields={ fields } item={ editing.id ? editing : {} } preset={ editing.id ? {} : editing } custom={ custom } onClose={ () => setEditing( null ) } onSaved={ reload } /> }
		</>
	);
}
