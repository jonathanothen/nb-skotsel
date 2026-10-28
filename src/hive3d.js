/**
 * 3D-vyn för kupbyggaren (three.js). Laddas först när vyn öppnas, så att resten av appen
 * inte bär på biblioteket.
 *
 * Enhet: 1 = 1 mm. Y uppåt. Kupans långsida (ramarnas överlist) går längs X, ramarna står
 * efter varandra längs Z och flustret sitter på kortsidan mot +X.
 * Ramarna är GLB-filer från biblioteket (genererade i Blender från ramparam.py), allt annat
 * byggs här från delarnas mått.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const COLORS = { bottom: 0x9a7448, box: 0xd2a56c, roof: 0x6f7c86, excluder: 0xb8865a, grid: 0xb9bcc0, other: 0xb89870 };
const GAP = 90; // avstånd mellan delarna i isärdragen vy

export function createHiveScene( el, { onPick } = {} ) {
	const renderer = new THREE.WebGLRenderer( { antialias: true, preserveDrawingBuffer: true } );
	renderer.setPixelRatio( Math.min( window.devicePixelRatio || 1, 2 ) );
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	el.appendChild( renderer.domElement );

	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0xf6f1e7 );
	const camera = new THREE.PerspectiveCamera( 35, 1, 10, 20000 );
	camera.position.set( 1400, 900, 1300 );

	scene.add( new THREE.HemisphereLight( 0xffffff, 0x8a7a66, 1.6 ) );
	const sun = new THREE.DirectionalLight( 0xffffff, 1.6 );
	sun.position.set( 900, 1600, 700 );
	scene.add( sun );
	const fill = new THREE.DirectionalLight( 0xffffff, 0.5 );
	fill.position.set( -900, 500, -600 );
	scene.add( fill );
	const grid = new THREE.GridHelper( 2000, 20, 0xd8ccb8, 0xe6dccb );
	scene.add( grid );

	const controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', render );

	const root = new THREE.Group();
	scene.add( root );
	const loader = new GLTFLoader();
	const frameCache = new Map();
	let token = 0;
	let fitted = false;

	function render() {
		renderer.render( scene, camera );
	}

	function resize() {
		const w = el.clientWidth || 300;
		const h = el.clientHeight || 300;
		renderer.setSize( w, h, false );
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		render();
	}
	const ro = new ResizeObserver( resize );
	ro.observe( el );

	function loadFrame( url ) {
		if ( ! frameCache.has( url ) ) {
			frameCache.set( url, new Promise( ( resolve, reject ) => loader.load( url, ( g ) => resolve( g.scene ), undefined, reject ) ) );
		}
		return frameCache.get( url );
	}

	// Klick (utan att rotera) väljer delen under pekaren.
	let down = null;
	renderer.domElement.addEventListener( 'pointerdown', ( e ) => ( down = [ e.clientX, e.clientY ] ) );
	renderer.domElement.addEventListener( 'pointerup', ( e ) => {
		if ( ! down || Math.hypot( e.clientX - down[ 0 ], e.clientY - down[ 1 ] ) > 4 || ! onPick ) {
			return;
		}
		const r = renderer.domElement.getBoundingClientRect();
		const ray = new THREE.Raycaster();
		ray.setFromCamera( new THREE.Vector2( ( ( e.clientX - r.left ) / r.width ) * 2 - 1, -( ( e.clientY - r.top ) / r.height ) * 2 + 1 ), camera );
		const hit = ray.intersectObjects( root.children, true )[ 0 ];
		let o = hit && hit.object;
		while ( o && o.userData.item === undefined ) {
			o = o.parent;
		}
		onPick( o ? o.userData.item : null );
	} );

	/**
	 * Ritar kupan. stack = [{ part, qty, frames }] nerifrån och upp, där part är bibliotekets
	 * del, qty antal av den och frames antal ramar per låda.
	 */
	async function setStack( stack, lib, { transparent = false, exploded = false, selected = null } = {} ) {
		const my = ++token;
		const frameUrls = {};
		for ( const f of lib.frames ) {
			if ( f.model ) {
				frameUrls[ f.id ] = lib.base + f.model;
			}
		}
		const needed = [ ...new Set( stack.filter( ( s ) => s.part.kind === 'box' && s.frames > 0 && frameUrls[ s.part.frame ] ).map( ( s ) => s.part.frame ) ) ];
		const frames = {};
		await Promise.all( needed.map( async ( id ) => {
			try {
				frames[ id ] = await loadFrame( frameUrls[ id ] );
			} catch ( e ) {
				frames[ id ] = null;
			}
		} ) );
		if ( my !== token ) {
			return; // en nyare ritning har startat
		}

		clear();
		let y = 0;
		stack.forEach( ( s, item ) => {
			for ( let n = 0; n < s.qty; n++ ) {
				const g = buildPart( s.part, y, { frames: frames[ s.part.frame ], frameInfo: lib.frames.find( ( f ) => f.id === s.part.frame ), count: s.frames, transparent, hi: item === selected, color: s.color } );
				g.userData.item = item;
				root.add( g );
				y += stackHeight( s.part ) + ( exploded ? GAP : 0 );
			}
		} );
		if ( ! fitted || stack.length === 0 ) {
			fit( Math.max( y, 300 ) );
			fitted = stack.length > 0;
		} else {
			controls.target.set( 0, Math.max( y, 300 ) / 2, 0 );
			controls.update();
		}
		render();
	}

	function fit( height ) {
		// Avstånd så att kupan (minst en låda bred) ryms med marginal även i smal vy.
		const size = Math.max( height, 700 );
		const fov = THREE.MathUtils.degToRad( camera.fov ) / 2;
		const d = ( size / Math.tan( fov ) ) * ( camera.aspect < 1 ? 1.1 / camera.aspect : 0.9 );
		const dir = new THREE.Vector3( 0.62, 0.42, 0.66 ).normalize();
		camera.position.set( dir.x * d, height / 2 + dir.y * d, dir.z * d );
		controls.target.set( 0, height / 2, 0 );
		controls.update();
	}

	function clear() {
		for ( const c of [ ...root.children ] ) {
			root.remove( c );
			c.traverse( ( o ) => {
				if ( o.userData.own ) {
					o.geometry.dispose();
					o.material.dispose();
				}
			} );
		}
	}

	function exportGlb() {
		return new Promise( ( resolve, reject ) => new GLTFExporter().parse( root, ( buf ) => resolve( new Blob( [ buf ], { type: 'model/gltf-binary' } ) ), reject, { binary: true } ) );
	}

	function snapshot() {
		render();
		return renderer.domElement.toDataURL( 'image/png' );
	}

	function dispose() {
		ro.disconnect();
		clear();
		controls.dispose();
		renderer.dispose();
		el.removeChild( renderer.domElement );
	}

	resize();
	return { setStack, exportGlb, snapshot, dispose, resetView: () => ( fitted = false ) };
}

/** Hur mycket en del höjer stapeln. Taket sitter över lådan och bidrar bara med sin topp. */
export function stackHeight( part ) {
	return part.kind === 'roof' ? part.top || 20 : part.height;
}

function material( kind, transparent, hi, color ) {
	const m = new THREE.MeshStandardMaterial( { color: color || COLORS[ kind ] || COLORS.other, roughness: 0.85, metalness: 0 } );
	if ( transparent ) {
		m.transparent = true;
		m.opacity = 0.22;
		m.depthWrite = false;
	}
	if ( hi ) {
		m.emissive = new THREE.Color( 0xffa424 );
		m.emissiveIntensity = 0.35;
	}
	return m;
}

/** Ett rätblock med x/y/z som [min, max]. */
function block( g, mat, [ x0, x1 ], [ y0, y1 ], [ z0, z1 ] ) {
	const m = new THREE.Mesh( new THREE.BoxGeometry( x1 - x0, y1 - y0, z1 - z0 ), mat.clone() );
	m.position.set( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, ( z0 + z1 ) / 2 );
	m.userData.own = true;
	// Mörka kanter så att lådorna syns som separata delar.
	const e = new THREE.LineSegments( new THREE.EdgesGeometry( m.geometry ), new THREE.LineBasicMaterial( { color: 0x3b2a1a, transparent: true, opacity: mat.transparent ? 0.35 : 0.55 } ) );
	e.userData.own = true;
	m.add( e );
	g.add( m );
	return m;
}

/** Ett rätblock med mitt, storlek och vridning runt Z (för sneda detaljer som handtag). */
function bar( g, mat, [ cx, cy, cz ], [ sx, sy, sz ], rotZ = 0 ) {
	const m = new THREE.Mesh( new THREE.BoxGeometry( sx, sy, sz ), mat.clone() );
	m.position.set( cx, cy, cz );
	m.rotation.z = rotZ;
	m.userData.own = true;
	g.add( m );
	return m;
}

/**
 * Utseende per fabrikat (part.look): body = huvudfärg, accent = plastlister, detail = handtag
 * och nät. Utan look ritas delen som en enkel trälåda.
 */
function lookMaterials( part, opts ) {
	const look = part.look || {};
	return {
		look,
		accent: material( 'accent', opts.transparent, opts.hi, look.accent || 0xe8a417 ),
		detail: material( 'detail', opts.transparent, opts.hi, look.detail || 0x8a8f94 ),
	};
}

function buildPart( part, y0, opts ) {
	const g = new THREE.Group();
	const mat = material( part.kind, opts.transparent, opts.hi, opts.color || ( part.look && part.look.body ) );
	const lm = lookMaterials( part, opts );
	const [ L, W ] = part.outer;
	const hx = L / 2;
	const hz = W / 2;
	if ( part.kind === 'box' ) {
		buildBox( g, part, y0, mat, opts, lm );
	} else if ( part.kind === 'bottom' ) {
		const t = part.wall || 20;
		const fl = part.floor || 20;
		const top = y0 + part.height;
		const [ ew, eh ] = part.entrance || [ W - 2 * t, 20 ];
		block( g, mat, [ -hx, hx ], [ y0, y0 + fl ], [ -hz, hz ] );
		block( g, mat, [ -hx, hx ], [ y0 + fl, top ], [ -hz, -hz + t ] );
		block( g, mat, [ -hx, hx ], [ y0 + fl, top ], [ hz - t, hz ] );
		block( g, mat, [ -hx, -hx + t ], [ y0 + fl, top ], [ -hz + t, hz - t ] );
		// Fluster i framgaveln (+X): öppning nertill, list ovanför och vid sidorna.
		block( g, mat, [ hx - t, hx ], [ y0 + fl + eh, top ], [ -hz + t, hz - t ] );
		const side = ( W - 2 * t - ew ) / 2;
		if ( side > 0 ) {
			block( g, mat, [ hx - t, hx ], [ y0 + fl, y0 + fl + eh ], [ -hz + t, -hz + t + side ] );
			block( g, mat, [ hx - t, hx ], [ y0 + fl, y0 + fl + eh ], [ hz - t - side, hz - t ] );
		}
		if ( lm.look.screen ) {
			// Nätbotten: mörkt nät i golvet och gul flusterlist framtill.
			block( g, lm.detail, [ -hx + t + 30, hx - t - 30 ], [ y0 + fl, y0 + fl + 1 ], [ -hz + t + 30, hz - t - 30 ] );
		}
		if ( lm.look.reducer ) {
			block( g, lm.accent, [ hx - t / 2 - 4, hx - t / 2 + 4 ], [ y0 + fl, y0 + fl + eh * 0.6 ], [ -ew / 2, ew / 2 ] );
		}
	} else if ( part.kind === 'roof' ) {
		const t = part.wall || 15;
		const top = part.top || 20;
		const skirt = part.height - top;
		const base = y0 - skirt; // kjolen går ner över lådan under
		block( g, mat, [ -hx, hx ], [ y0, y0 + top ], [ -hz, hz ] );
		block( g, mat, [ -hx, hx ], [ base, y0 ], [ -hz, -hz + t ] );
		block( g, mat, [ -hx, hx ], [ base, y0 ], [ hz - t, hz ] );
		block( g, mat, [ -hx, -hx + t ], [ base, y0 ], [ -hz + t, hz - t ] );
		block( g, mat, [ hx - t, hx ], [ base, y0 ], [ -hz + t, hz - t ] );
		if ( lm.look.ribs ) {
			// Räfflat lock: upphöjda ribbor på ovansidan.
			const n = lm.look.ribs;
			for ( let i = 0; i < n; i++ ) {
				const z = -hz + 40 + ( i * ( W - 80 ) ) / ( n - 1 );
				block( g, mat, [ -hx + 30, hx - 30 ], [ y0 + top, y0 + top + 5 ], [ z - 6, z + 6 ] );
			}
		}
	} else if ( part.kind === 'excluder' && lm.look.sheet ) {
		// Spärrgaller av plast: ett tunt ark utan ram.
		block( g, lm.detail, [ -hx, hx ], [ y0, y0 + part.height ], [ -hz, hz ] );
	} else if ( part.kind === 'excluder' ) {
		// Spärrgaller: träram runt om och ett tunt galler i mitten.
		const t = part.rim || 20;
		const top = y0 + part.height;
		block( g, mat, [ -hx, hx ], [ y0, top ], [ -hz, -hz + t ] );
		block( g, mat, [ -hx, hx ], [ y0, top ], [ hz - t, hz ] );
		block( g, mat, [ -hx, -hx + t ], [ y0, top ], [ -hz + t, hz - t ] );
		block( g, mat, [ hx - t, hx ], [ y0, top ], [ -hz + t, hz - t ] );
		const metal = material( 'grid', opts.transparent, opts.hi );
		metal.metalness = 0.6;
		metal.roughness = 0.35;
		block( g, metal, [ -hx + t, hx - t ], [ y0 + part.height / 2 - 0.5, y0 + part.height / 2 + 0.5 ], [ -hz + t, hz - t ] );
		metal.dispose();
	} else {
		block( g, mat, [ -hx, hx ], [ y0, y0 + part.height ], [ -hz, hz ] );
	}
	mat.dispose();
	lm.accent.dispose();
	lm.detail.dispose();
	return g;
}

/**
 * Låda: långsidor över hela längden, gavlar emellan. Gavlarna har fals överst där ramarnas
 * öron vilar. Ramarna hängs i falsen med 35 mm c/c (systemets spacing), centrerade.
 */
function buildBox( g, part, y0, mat, { frames, frameInfo, count }, lm ) {
	const [ L, W ] = part.outer;
	const hx = L / 2;
	const hz = W / 2;
	const t = part.wall || 20;
	const H = part.height;
	const [ rw, rd ] = part.rabbet || [ 10, 10 ];
	const top = y0 + H;
	// Trälådor: långsidorna går över hela längden. Cellplastlådor (look.edges): gavlarna går över
	// hela bredden, så att plastkanterna syns över hela gaveln.
	const full = !! lm.look.edges;
	const lx = full ? hx - t : hx;
	const ez = full ? hz : hz - t;
	block( g, mat, [ -lx, lx ], [ y0, top ], [ -hz, -hz + t ] );
	block( g, mat, [ -lx, lx ], [ y0, top ], [ hz - t, hz ] );
	for ( const s of [ -1, 1 ] ) {
		const outerX = s * hx;
		const innerX = s * ( hx - t );
		const rabX = s * ( hx - t + rw );
		const x = ( a, b ) => [ Math.min( a, b ), Math.max( a, b ) ];
		if ( ! lm.look.edges ) {
			block( g, mat, x( outerX, innerX ), [ y0, top - rd ], [ -ez, ez ] );
			block( g, mat, x( outerX, rabX ), [ top - rd, top ], [ -ez, ez ] );
			continue;
		}
		// Gavel med hårdplastkant upptill och nertill och en plastlist i falsen där ramarna vilar.
		const e = lm.look.edges;
		block( g, lm.accent, x( outerX, innerX ), [ y0, y0 + e ], [ -ez, ez ] );
		block( g, mat, x( outerX, innerX ), [ y0 + e, top - rd - 3 ], [ -ez, ez ] );
		block( g, lm.accent, x( outerX, innerX ), [ top - rd - 3, top - rd ], [ -ez, ez ] );
		block( g, mat, x( outerX, rabX ), [ top - rd, top - e ], [ -ez, ez ] );
		block( g, lm.accent, x( outerX, rabX ), [ top - e, top ], [ -ez, ez ] );
	}
	if ( lm.look.handles ) {
		// Grepp: avlångt spår i gavlarna och vinklat grepp på långsidorna (ritade som mörka fält).
		const hy = y0 + H * 0.66;
		for ( const s of [ -1, 1 ] ) {
			bar( g, lm.detail, [ s * ( hx + 0.6 ), hy, 0 ], [ 1, 22, W * 0.42 ] );
			const z = s * ( hz + 0.6 );
			const len = L * 0.36;
			bar( g, lm.detail, [ 0, hy, z ], [ len, 16, 1 ] );
			const d = 0.75;
			for ( const side of [ -1, 1 ] ) {
				bar( g, lm.detail, [ side * ( len / 2 + 22 ), hy - 22, z ], [ 64, 16, 1 ], -side * d );
			}
		}
	}
	if ( ! frames || ! frameInfo || ! count ) {
		return;
	}
	const pitch = 35;
	const fy = top - ( part.topSpace || 0 ) - frameInfo.height;
	const n = Math.min( count, part.frames || count );
	for ( let i = 0; i < n; i++ ) {
		const f = frames.clone( true );
		f.position.set( 0, fy, ( i - ( n - 1 ) / 2 ) * pitch );
		g.add( f );
	}
}
