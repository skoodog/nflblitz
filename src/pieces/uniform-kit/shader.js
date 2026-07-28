// PIECE uniform-kit — the kit shader.
//
// WHY A SHADER AND NOT A BAKED ATLAS. character-anatomy merges the torso, the shoulder
// shelf and both sleeves into ONE geometry group in the `jersey` slot, and each of those
// parts carries a DIFFERENT uv convention (the torso wraps u once around the body with
// v = hem..collar; a sleeve wraps u once around the ARM with v = shoulder..cuff; the pad
// shelf sweeps u along its own ring). There is therefore no single uv layout in which a
// chest number can be painted without also smearing a copy of itself across both shoulder
// pads. A baked jersey atlas cannot work on this mesh — that is a measured fact about the
// geometry, not a preference.
//
// So identity is PROJECTED, exactly the way a real engine applies decals: every fragment
// knows its own REST-POSE object position (captured before skinning, so it is invariant
// under any pose the pose piece throws at it), and colour blocking, piping, stripes and
// the tackle-twill numbers are all computed from that. Surface detail comes from shared
// tiling maps sampled triplanar, so the knit runs at the same physical scale on the chest,
// the sleeve and the pad shelf.
//
// PROGRAM BUDGET. One onBeforeCompile, one define. `customProgramCacheKey()` returns
// `onBeforeCompile.toString()`, and three folds `material.defines` into the same key, so
// the ENTIRE kit — 32 clubs x 5 variants x 12 material slots — compiles exactly TWO
// programs (KIT_FAMILY 0 cloth, 1 hard) plus the stock MeshStandard program the remaining
// slots share. Colour, dirt and wetness are uniforms; switching a variant re-uploads
// twelve vec3s and compiles nothing. Rung changes only scale texture resolution and turn
// layers off via uniforms, so a rung sweep also compiles nothing.

/* --------------------------------------------------------------- constants */

/** Rest-pose landmarks for the canonical 1.88 m rig (see src/foundation/rig.js). */
export const LM = {
  yHem: 0.955,
  yCollar: 1.545,
  yShoulder: 1.452,
  yHip: 0.980,
  yKnee: 0.500,
  yAnkle: 0.100,
  yNeck: 1.540,
  headY: 1.762,
  headZ: 0.012,
  headR: 0.118,
  torsoR: 0.190,
};

const COMMON = /* glsl */`
varying vec3 vKitPos;
varying vec3 vKitNrm;
`;

const FRAG_PARS = /* glsl */`
uniform sampler2D uKitDetail;
uniform sampler2D uKitDecal;
uniform sampler2D uKitGrime;
uniform vec3 uKitA;      // base
uniform vec3 uKitB;      // yoke / secondary block
uniform vec3 uKitC;      // stretch panel
uniform vec3 uKitD;      // trim + piping
uniform vec3 uKitE;      // tertiary (sock top / helmet stripe / cleat trim)
uniform vec3 uKitF;      // far-LOD companion colour (pants) so a 1-slot actor still reads
uniform vec3 uKitG;      // far-LOD companion colour (helmet)
uniform vec4 uKitP;      // x part  y dirt  z wet  w matte
uniform vec4 uKitQ;      // x tile  y bump  z decal  w scale
uniform vec4 uKitR;      // x sleeveBands  y roughBase  z metalBase  w detailAmt

float  gKitH;
vec3   gKitAlb;
float  gKitRough;
float  gKitMetal;
float  gKitAO;

const float KPI = 3.14159265;

vec4 kitTri( sampler2D s, vec3 p, vec3 n, float tile ) {
  vec3 a = abs( n );
  a *= a;
  a /= ( a.x + a.y + a.z + 1e-4 );
  vec4 cx = texture2D( s, p.zy * tile );
  vec4 cy = texture2D( s, p.xz * tile );
  vec4 cz = texture2D( s, p.xy * tile );
  return cx * a.x + cy * a.y + cz * a.z;
}

/** One clamped atlas cell lookup. Returns 0 outside the cell so a decal never bleeds. */
vec4 kitCell( vec2 uv, vec4 cell ) {
  vec2 c = clamp( uv, 0.0, 1.0 );
  float m = step( 0.0, uv.x ) * step( uv.x, 1.0 ) * step( 0.0, uv.y ) * step( uv.y, 1.0 );
  vec4 s = texture2D( uKitDecal, cell.xy + c * cell.zw );
  return s * m;
}

/** A soft band centred on c, half-width w, with a feathered edge f. */
float kitBand( float x, float c, float w, float f ) {
  return 1.0 - smoothstep( w, w + f, abs( x - c ) );
}

/** Grime: mud low and on the front, grass smears, sweat sheen on the shoulders. */
void kitGrime( inout vec3 col, inout float rough, vec3 p, vec3 n, float scale ) {
  float dirt = uKitP.y;
  float wet  = uKitP.z;
  if ( dirt <= 0.001 && wet <= 0.001 ) return;
  vec4 g = kitTri( uKitGrime, p, n, 1.35 );
  // mud collects low and on upward/forward faces
  float low = 1.0 - smoothstep( 0.35 * scale, 1.25 * scale, p.y );
  float face = clamp( n.z * 0.45 + n.y * 0.55 + 0.35, 0.0, 1.0 );
  float mud = clamp( g.x * ( 0.45 + low * 0.95 ) * face * dirt * 1.85, 0.0, 1.0 );
  float grass = clamp( g.y * low * dirt * 1.15, 0.0, 1.0 );
  col = mix( col, vec3( 0.113, 0.082, 0.055 ), mud * 0.86 );
  col = mix( col, vec3( 0.094, 0.128, 0.048 ), grass * 0.40 );
  rough = mix( rough, 0.92, mud * 0.7 );
  // sweat: darkens and glosses the cloth on the chest, shoulders and back
  float high = smoothstep( 0.85 * scale, 1.5 * scale, p.y );
  float sweat = clamp( g.z * ( 0.30 + high * 0.85 ) * wet, 0.0, 1.0 );
  col *= ( 1.0 - sweat * 0.30 );
  rough = mix( rough, 0.13, sweat * 0.72 );
}
`;

/* ----------------------------------------------------------- cloth family */

const CLOTH = /* glsl */`
void kitShadeCloth() {
  float S = uKitQ.w;
  vec3 p = vKitPos;
  vec3 n = normalize( vKitNrm );
  float part = uKitP.x;

  float yHem = ${LM.yHem} * S;
  float yCol = ${LM.yCollar} * S;
  float yShl = ${LM.yShoulder} * S;
  float yHip = ${LM.yHip} * S;

  vec4 det = kitTri( uKitDetail, p, n, uKitQ.x );
  float ang = atan( p.x, p.z );
  float aang = abs( ang );
  float armness = smoothstep( 0.245 * S, 0.345 * S, abs( p.x ) );

  vec3 col = uKitA;
  float rough = uKitR.y;
  float metal = uKitR.z;
  float ao = 1.0;
  float h = det.g;

  // ---- FAR-LOD SAFETY -----------------------------------------------------
  // At LOD2/LOD3 character-anatomy collapses every slot into "jersey", so this one
  // material has to dress the whole body. Height bands keep a distant actor reading
  // as a football player instead of a jersey-coloured blob. Free: two mixes.
  float belowHem = 1.0 - smoothstep( yHem - 0.05 * S, yHem + 0.01 * S, p.y );
  float aboveCol = smoothstep( yCol + 0.02 * S, yCol + 0.10 * S, p.y );

  if ( part < 0.5 ) {
    /* ================================================== JERSEY ============ */

    // stretch side panel: the two-material body panel every modern jersey has
    float side = smoothstep( 0.72, 1.05, aang ) * ( 1.0 - smoothstep( 1.85, 2.25, aang ) );
    col = mix( col, uKitC, side * 0.9 * ( 1.0 - armness ) );
    // the panel is perforated mesh — pinholes darken it and roughen it
    float mesh = det.a * side * ( 1.0 - armness );
    col *= ( 1.0 - mesh * 0.34 );
    ao *= ( 1.0 - mesh * 0.30 );

    // shoulder yoke: over the shelf and down the sleeve cap
    float yoke = smoothstep( yShl - 0.115 * S, yShl - 0.030 * S, p.y );
    float cap  = 1.0 - smoothstep( 0.285 * S, 0.455 * S, abs( p.x ) );
    float yokeM = max( yoke, cap * step( 0.30 * S, abs( p.x ) ) );
    col = mix( col, uKitB, clamp( yokeM, 0.0, 1.0 ) * 0.95 );

    // SLEEVE STRIPES. Every club puts a stripe set on the sleeve, and at panel scale it is
    // the most legible piece of kit identity after the number.
    //
    // THE ZONE HAS TO BE DERIVED, NOT GUESSED. character-anatomy's sleeve runs |x| 0.17
    // to 0.30 along a 45-degree arm axis, while the shoulder-pad shelf — SAME material
    // slot, same merged group — reaches |x| 0.384 sitting flat at y 1.40 to 1.52. So |x|
    // alone cannot separate sleeve from pad; the pair (|x| large AND y below the shelf)
    // can, because the arm has already descended by the time it is that far out.
    float sleeveZone = step( 0.215 * S, abs( p.x ) )
                     * ( 1.0 - smoothstep( 1.352 * S, 1.428 * S, p.y ) );
    float sx = clamp( ( abs( p.x ) - 0.215 * S ) / ( 0.095 * S ), 0.0, 1.4 );
    float sA = kitBand( sx, 0.60, 0.095, 0.045 );
    float sB = kitBand( sx, 0.92, 0.085, 0.045 );
    float sMid = kitBand( sx, 0.76, 0.045, 0.030 );
    col = mix( col, uKitD, clamp( sA + sB, 0.0, 1.0 ) * sleeveZone * 0.95 );
    col = mix( col, uKitE, sMid * sleeveZone * 0.85 );

    // piping: shoulder seam, side seam, sleeve hem, collar
    float pipe = 0.0;
    pipe = max( pipe, kitBand( p.y, yShl - 0.052 * S, 0.0030 * S, 0.0022 * S ) * ( 1.0 - armness ) );
    pipe = max( pipe, kitBand( aang, 1.42, 0.007, 0.007 ) * ( 1.0 - armness ) * smoothstep( yHem, yHem + 0.08 * S, p.y ) );
    pipe = max( pipe, kitBand( sx, 1.06, 0.010, 0.010 ) * sleeveZone );
    col = mix( col, uKitD, pipe * 0.92 );

    // collar band
    float collar = smoothstep( yCol - 0.035 * S, yCol - 0.004 * S, p.y ) * ( 1.0 - armness );
    col = mix( col, uKitD, collar * 0.75 );

    // throwback: a third, wider band low on the sleeve plus a chest yoke stripe
    if ( uKitR.x > 0.5 ) {
      col = mix( col, uKitD, kitBand( sx, 0.32, 0.085, 0.040 ) * sleeveZone * 0.95 );
      col = mix( col, uKitD, kitBand( p.y, yShl - 0.175 * S, 0.014 * S, 0.006 * S ) * ( 1.0 - armness ) * 0.9 );
    }

    // ---- decals: chest number front, name + number back ------------------
    if ( uKitQ.z > 0.5 ) {
      float back = step( n.z, 0.0 );
      float angB = ang > 0.0 ? ( KPI - ang ) : ( -KPI - ang );
      float arc  = mix( ang, -angB, back ) * ${LM.torsoR};
      float y0 = mix( 1.098, 1.098, back ) * S;
      float y1 = mix( 1.398, 1.462, back ) * S;
      float hw = mix( 0.150, 0.160, back ) * S;
      vec2 duv = vec2( arc / ( 2.0 * hw ) + 0.5, ( y1 - p.y ) / ( y1 - y0 ) );
      vec4 cell = mix( vec4( 0.0, 0.0, 0.5, 0.5 ), vec4( 0.5, 0.0, 0.5, 0.5 ), back );
      vec4 d = kitCell( duv, cell ) * ( 1.0 - armness );
      col = mix( col, d.rgb, d.a );
      rough = mix( rough, 0.72, d.a );
      h = mix( h, h * 0.35 + 0.72, d.a );          // the twill sits proud of the knit

      // sleeve crest, on the outer face of the upper arm
      float sl = armness * smoothstep( 0.42, 0.75, abs( n.z ) );
      vec2 suv = vec2( ( p.z * ( n.z > 0.0 ? 1.0 : -1.0 ) + 0.085 * S ) / ( 0.17 * S ),
                       ( 1.415 * S - p.y ) / ( 0.155 * S ) );
      vec4 sd = kitCell( suv, vec4( 0.0, 0.5, 0.25, 0.25 ) ) * sl;
      col = mix( col, sd.rgb, sd.a * 0.95 );
    }

    // far-LOD companions
    col = mix( col, uKitF, belowHem );
    col = mix( col, uKitG, aboveCol );

  } else if ( part < 1.5 ) {
    /* =================================================== PANTS ============ */
    col = uKitA;
    // waistband / belt
    float belt = kitBand( p.y, yHip + 0.028 * S, 0.030 * S, 0.008 * S );
    col = mix( col, uKitB, belt * 0.9 );
    float beltLine = kitBand( p.y, yHip + 0.028 * S, 0.004 * S, 0.003 * S );
    col = mix( col, uKitD, beltLine * 0.8 );
    // outer side stripe: only where the surface actually faces laterally outward
    float outer = smoothstep( 0.52, 0.86, abs( n.x ) ) * step( 0.0, n.x * p.x );
    float leg = 1.0 - smoothstep( yHip - 0.02 * S, yHip + 0.05 * S, p.y );
    float stripe = outer * leg;
    col = mix( col, uKitD, stripe * 0.92 );
    float hair = stripe * kitBand( abs( n.x ), 1.0, 0.10, 0.06 );
    col = mix( col, uKitE, hair * 0.35 );
    // knee / thigh pad shading — the pads live inside the pants and read as bulges
    float knee = kitBand( p.y, 0.585 * S, 0.075 * S, 0.055 * S ) * clamp( n.z, 0.0, 1.0 );
    float thigh = kitBand( p.y, 0.775 * S, 0.105 * S, 0.070 * S ) * clamp( n.z, 0.0, 1.0 );
    ao *= 1.0 - ( knee + thigh ) * 0.13;
    h += ( knee * 0.5 + thigh * 0.4 );
    rough = mix( rough, rough * 0.82, knee + thigh );
    // The jersey hem overhangs the pants and casts a real contact shadow across the top
    // of them. Without it the waist is the brightest thing on a dark-jersey/light-pants
    // kit and the eye goes straight to the player's belt instead of his number.
    col *= 1.0 - 0.44 * smoothstep( yHip - 0.13 * S, yHip + 0.05 * S, p.y );
    // Ambient occlusion up the inside of the legs and into the seat. Light pants with no
    // AO read as two lit cylinders; this is the term that makes them read as ONE garment.
    float inner = ( 1.0 - smoothstep( 0.035 * S, 0.150 * S, abs( p.x ) ) )
                * smoothstep( 0.55 * S, 0.80 * S, p.y )
                * ( 1.0 - smoothstep( 0.88 * S, 1.02 * S, p.y ) );
    col *= 1.0 - 0.62 * inner;
    ao *= 1.0 - 0.35 * inner;

    // hip mark
    if ( uKitQ.z > 0.5 ) {
      vec2 huv = vec2( ( p.z + 0.09 * S ) / ( 0.18 * S ), ( 0.965 * S - p.y ) / ( 0.12 * S ) );
      vec4 hd = kitCell( huv, vec4( 0.5, 0.5, 0.25, 0.25 ) ) * outer;
      col = mix( col, hd.rgb, hd.a * 0.85 );
    }

  } else if ( part < 2.5 ) {
    /* =================================================== SOCK ============= */
    float t = clamp( ( p.y - 0.085 * S ) / ( 0.44 * S ), 0.0, 1.0 );
    col = uKitA;
    col = mix( col, uKitE, smoothstep( 0.68, 0.78, t ) );            // upper block
    float s1 = kitBand( t, 0.60, 0.030, 0.012 );
    float s2 = kitBand( t, 0.68, 0.016, 0.010 );
    col = mix( col, uKitD, clamp( s1 + s2, 0.0, 1.0 ) * 0.95 );
    ao *= 1.0 - smoothstep( 0.02, 0.0, t ) * 0.2;

  } else if ( part < 3.5 ) {
    /* ============================================== UNDERSHIRT / TOWEL === */
    col = uKitA;
    float cuff = kitBand( abs( p.x ), 0.505 * S, 0.010 * S, 0.008 * S );
    col = mix( col, uKitD, cuff * 0.5 );

  } else if ( part < 4.5 ) {
    /* ==================================================== GLOVE ========== */
    // leather back, silicone grip palm. The palm faces the body in the rest pose,
    // so the grip is keyed off the inward-facing normal rather than a uv island.
    float palm = smoothstep( 0.15, 0.62, -n.z * sign( 1.0 ) );
    col = uKitA;
    float grip = det.w * clamp( palm + 0.25, 0.0, 1.0 );
    col = mix( col, uKitD, grip * 0.55 );
    rough = clamp( mix( 0.46, 0.28, grip ) + ( det.z - 0.5 ) * 0.25, 0.05, 1.0 );
    metal = 0.04;
    h = det.g * ( 0.6 + grip * 0.8 );
    // wrist cuff
    float cuff = kitBand( abs( p.x ), 0.585 * S, 0.020 * S, 0.012 * S );
    col = mix( col, uKitB, cuff * 0.85 );

  } else if ( part < 5.5 ) {
    /* ==================================================== CLEAT ========== */
    float sole = 1.0 - smoothstep( 0.028 * S, 0.052 * S, p.y );
    col = mix( uKitA, uKitB, sole );
    // lateral flash along the outer wall
    float flash = smoothstep( 0.45, 0.85, abs( n.x ) )
                * kitBand( p.y, 0.072 * S, 0.020 * S, 0.014 * S );
    col = mix( col, uKitD, flash * 0.9 );
    rough = mix( 0.16, 0.78, sole );
    rough = clamp( rough + ( det.z - 0.5 ) * 0.20, 0.05, 1.0 );
    metal = mix( 0.10, 0.0, sole );
    h = det.g * ( 0.5 + sole * 1.1 );

  } else {
    /* ===================================================== SKIN ========== */
    col = uKitA * ( 0.90 + det.x * 0.22 );
    rough = clamp( 0.52 + ( det.z - 0.5 ) * 0.22, 0.14, 1.0 );
    metal = 0.0;
    h = det.g * 0.55;
    // sweat beads: wet-driven speculars sitting on the forearms and neck
    float bead = det.w * uKitP.z;
    rough = mix( rough, 0.09, bead * 0.85 );
    col *= ( 1.0 - bead * 0.10 );
    h += bead * 0.5;
  }

  // ---- fabric ------------------------------------------------------------
  // A club like Chicago (#0B162A) or Baltimore is nearly black. Left alone it resolves to
  // a silhouette with no readable form, which is the classic dark-jersey failure. The knit
  // gets a floor and a grazing-angle sheen so the weave, the seams and the shoulder shelf
  // stay legible without lifting the value structure off the bar's near-black midtones.
  float lift = mix( 1.0, det.x + 0.38, uKitR.w );
  col = max( col * lift, col * 0.55 + vec3( 0.0055 ) );
  rough = clamp( rough + ( det.z - 0.5 ) * 0.30 * uKitR.w, 0.06, 1.0 );
  rough = mix( rough, min( 1.0, rough + 0.16 ), uKitP.w );          // throwback matte

  kitGrime( col, rough, p, n, S );

  gKitAlb = col;
  gKitRough = rough;
  gKitMetal = metal;
  gKitAO = ao;
  gKitH = h;
}
`;

/* ------------------------------------------------------------ hard family */

const HARD = /* glsl */`
void kitShadeHard() {
  float S = uKitQ.w;
  vec3 p = vKitPos;
  vec3 n = normalize( vKitNrm );
  float part = uKitP.x;

  vec3 hc = vec3( 0.0, ${LM.headY} * 1.0, ${LM.headZ} * 1.0 ) * vec3( 1.0, S, S );
  vec3 q = p - hc;

  vec4 det = kitTri( uKitDetail, p, n, uKitQ.x );
  vec3 col = uKitA;
  float rough = uKitR.y;
  float metal = uKitR.z;
  float ao = 1.0;
  float h = det.g;

  if ( part < 0.5 ) {
    /* ================================================== HELMET SHELL ===== */
    // deep candy coat: metallic flake speckle under a clearcoat, plus a shell
    // gradient that keeps the crown brighter than the jaw
    float flake = det.x;
    col = uKitA * ( 0.96 + flake * 0.34 ) + vec3( 0.006 );
    metal = clamp( uKitR.z + flake * 0.22, 0.0, 1.0 );
    rough = clamp( uKitR.y + ( det.z - 0.5 ) * 0.10, 0.02, 1.0 );

    // crown stripe: runs the full front-to-back centreline, as it does on a real shell,
    // so it is legible head-on and not only from directly above
    float crown = smoothstep( -0.075 * S, 0.010 * S, q.y );
    float stripe = kitBand( q.x, 0.0, 0.026 * S, 0.011 * S ) * crown;
    float stripeEdge = ( kitBand( q.x, 0.037 * S, 0.005 * S, 0.004 * S )
                       + kitBand( q.x, -0.037 * S, 0.005 * S, 0.004 * S ) )
                       * crown;
    col = mix( col, uKitB, stripe * 0.95 );
    col = mix( col, uKitD, clamp( stripeEdge, 0.0, 1.0 ) * 0.9 );

    // side decal, projected along X onto whichever cheek faces outward
    if ( uKitQ.z > 0.5 ) {
      float sgn = n.x > 0.0 ? 1.0 : -1.0;
      float faceSide = smoothstep( 0.42, 0.82, abs( n.x ) );
      vec2 duv = vec2( ( -q.z * sgn + 0.085 * S ) / ( 0.155 * S ),
                       ( 0.052 * S - q.y ) / ( 0.135 * S ) );
      vec4 d = kitCell( duv, vec4( 0.25, 0.5, 0.25, 0.25 ) ) * faceSide;
      col = mix( col, d.rgb, d.a * 0.96 );
      rough = mix( rough, max( 0.05, rough * 0.8 ), d.a );
    }
    // rear bumper + facemask clip shading
    float scuff = det.w;
    col *= ( 1.0 - scuff * 0.22 );
    rough = clamp( rough + scuff * 0.35, 0.02, 1.0 );

  } else if ( part < 1.5 ) {
    /* ==================================================== FACEMASK ======= */
    col = uKitA * ( 0.92 + det.x * 0.16 );
    rough = clamp( 0.42 + ( det.z - 0.5 ) * 0.28, 0.10, 1.0 );
    metal = 0.30;
    h = det.g * 0.5;

  } else if ( part < 2.5 ) {
    /* ======================================================= VISOR ======= */
    col = uKitA;
    rough = 0.045;
    metal = 0.62;
    h = 0.0;

  } else {
    /* ================================================ PAD / EPAULETTE ==== */
    col = uKitA;
    rough = clamp( uKitR.y + 0.12, 0.1, 1.0 );
    metal = 0.0;
  }

  kitGrime( col, rough, p, n, S );

  gKitAlb = col;
  gKitRough = rough;
  gKitMetal = metal;
  gKitAO = ao;
  gKitH = h;
}
`;

/* --------------------------------------------------------------- assembly */

const VERT_MAIN_NORMAL = 'vKitNrm = objectNormal;';
const VERT_MAIN_POS = 'vKitPos = transformed;';

const FRAG_DISPATCH = /* glsl */`
#if KIT_FAMILY == 1
  kitShadeHard();
#else
  kitShadeCloth();
#endif
  diffuseColor.rgb = gKitAlb;
`;

const FRAG_NORMAL = /* glsl */`
#ifdef USE_KIT_BUMP
  {
    vec3 sp = -vViewPosition;
    vec3 sx = normalize( dFdx( sp ) );
    vec3 sy = normalize( dFdy( sp ) );
    vec3 vN = normal;
    vec3 R1 = cross( sy, vN );
    vec3 R2 = cross( vN, sx );
    float fDet = dot( sx, R1 );
    vec2 dH = vec2( dFdx( gKitH ), dFdy( gKitH ) ) * uKitQ.y;
    vec3 vGrad = sign( fDet ) * ( dH.x * R1 + dH.y * R2 );
    normal = normalize( abs( fDet ) * vN - vGrad );
  }
#endif
`;

/**
 * The ONE onBeforeCompile every kit material shares. Its source text is the program
 * cache key, so sharing the function literal is what collapses 160 material sets into
 * two programs. Per-material data arrives through `this.userData.kit`.
 */
export function kitOnBeforeCompile(shader) {
  const u = this.userData.kitUniforms;
  for (const k in u) shader.uniforms[k] = u[k];

  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${COMMON}`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n\t${VERT_MAIN_NORMAL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n\t${VERT_MAIN_POS}`);

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${COMMON}\n${FRAG_PARS}\n${CLOTH}\n${HARD}`)
    .replace('#include <map_fragment>', FRAG_DISPATCH)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gKitRough;')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = gKitMetal;')
    .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
    .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= gKitAO;');
}

export default { kitOnBeforeCompile, LM };
