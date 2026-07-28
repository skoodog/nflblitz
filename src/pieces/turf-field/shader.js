// PIECE turf-field — the turf shader.
//
// A MeshStandardMaterial patched through onBeforeCompile, so the field still gets the
// scene's real lights, shadows and IBL from whatever `stadium-lighting` installs. What
// is added here is everything a standard material cannot do on a ground plane:
//
//   * ANALYTIC field paint. Yard lines, goal lines, hashes, sideline ticks, numerals
//     and arrows are signed-distance shapes evaluated per pixel with fwidth-based
//     antialiasing — not a baked 4K sheet. Under a raking camera a baked sheet turns to
//     mip soup exactly where the critic is looking; an analytic line stays a line.
//   * MOW STRIPES as a real normal tilt, so they respond to the key light and to the
//     view direction the way cut grass actually does, instead of being a painted band.
//   * A WET ANISOTROPIC SHEEN driven by the stadium light banks (field.js BANKS). This
//     is the material's reflection response, not scene illumination — it is the only
//     way to get the long reflected streaks the bar's field throws back at a low camera.
//   * A DAMAGE BUFFER: torn soil, cleat prints and skids, with the mask edge broken up
//     by the blade sheet so a divot has a ragged border instead of a stamped one.
//
// Cost is on the 16-rung ladder. TURF_CLASS is the only #define that changes with the
// rung, and it only changes at a play boundary (foundation quality.js calls that the
// EXPENSIVE axis). Everything else is a uniform.

import * as THREE from 'three';
import {
  GOAL_X, END_X, HALF_W, LINE_HW, GOAL_HW, BORDER, HASH_Z, HASH_HALF_LEN,
  YD, NUM_TOP_Z, NUM_BOT_Z, DIGIT_W, DIGIT_GAP, MOW_PERIOD, ARROW_OFF, ARROW_LEN, ARROW_HW,
} from './field.js';

const F = (n) => (Math.round(n * 1e6) / 1e6).toFixed(6);

const DEFS = `
#define TF_GOAL_X ${F(GOAL_X)}
#define TF_END_X ${F(END_X)}
#define TF_HALF_W ${F(HALF_W)}
#define TF_LINE_HW ${F(LINE_HW)}
#define TF_GOAL_HW ${F(GOAL_HW)}
#define TF_BORDER ${F(BORDER)}
#define TF_HASH_Z ${F(HASH_Z)}
#define TF_HASH_HL ${F(HASH_HALF_LEN)}
#define TF_YD ${F(YD)}
#define TF_MOW ${F(MOW_PERIOD)}
#define TF_NUM_T ${F(NUM_TOP_Z)}
#define TF_NUM_B ${F(NUM_BOT_Z)}
#define TF_NUM_H ${F(NUM_BOT_Z - NUM_TOP_Z)}
#define TF_DIG_W ${F(DIGIT_W)}
#define TF_DIG_C ${F(DIGIT_GAP * 0.5 + DIGIT_W * 0.5)}
#define TF_ARR_O ${F(ARROW_OFF)}
#define TF_ARR_L ${F(ARROW_LEN)}
#define TF_ARR_HW ${F(ARROW_HW)}
`;

/* ------------------------------------------------------------------ vertex */

const VERT_COMMON = `
varying vec3 vTurfWP;
`;

const VERT_BODY = `
#include <begin_vertex>
vTurfWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

/* ---------------------------------------------------------------- fragment */

const FRAG_COMMON = `
varying vec3 vTurfWP;

uniform sampler2D uTDetail;
uniform sampler2D uTMacro;
uniform sampler2D uTSoil;
uniform sampler2D uTNum;
uniform sampler2D uTWord;
uniform sampler2D uTCrest;
#if TURF_NORMALMAP
uniform sampler2D uTDetailN;
#endif
#if TURF_DAMAGE
uniform sampler2D uTDamage;
uniform vec4 uDamageWin;   // cx, cz, halfX, halfZ
#endif

uniform vec3 uBanks[ TURF_BANKS ];
uniform vec3 uBankColor;
uniform vec3 uSkyColor;
uniform vec3 uEZ0;
uniform vec3 uEZ1;
uniform vec3 uPaintTint;
uniform float uWet;
uniform float uPaintWear;
uniform float uSheen;
uniform float uMow;
uniform float uGrassGain;
uniform float uSoilGain;
uniform float uEZOn;

vec3 gTurfSpec;
vec3 gTurfN;
float gTurfRough;

float tfBand( float d, float hw, float w ) {
  return 1.0 - smoothstep( hw - w, hw + w, d );
}

// Distance to the nearest repeat of the given period, in metres.
float tfRepeat( float x, float period ) {
  return abs( fract( x / period + 0.5 ) - 0.5 ) * period;
}

vec3 tfSat( vec3 c, float k ) {
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  return max( vec3( 0.0 ), mix( vec3( l ), c, k ) );
}

void turfShade() {
  vec3 wp = vTurfWP;
  vec2 P = wp.xz;
  vec3 V = normalize( cameraPosition - wp );

  float fwx = max( fwidth( P.x ), 1e-5 );
  float fwz = max( fwidth( P.y ), 1e-5 );
  float fw  = max( fwx, fwz );
  float detFade = 1.0 - smoothstep( 0.010, 0.135, fw );

  float ax = abs( P.x );
  float az = abs( P.y );

  /* ------------------------------------------------------------- the sheet */

  vec4 dt = texture2D( uTDetail, P * 0.826446 );          // 1.21 m tile
  vec4 mc = texture2D( uTMacro, P * 0.0884956 );          // 11.3 m tile
#if TURF_DETAIL2
  vec2 Pr = vec2( P.x * 0.7071 - P.y * 0.7071, P.x * 0.7071 + P.y * 0.7071 );
  vec4 dt2 = texture2D( uTDetail, Pr * 1.886792 );        // 0.53 m tile, rotated 45deg
  // modulate CONTRAST with the second octave, never multiply albedo by albedo — that
  // is how a grass sheet turns into mush at close range
  float d2l = clamp( dot( dt2.rgb, vec3( 1.25, 1.95, 0.70 ) ), 0.0, 1.0 );
  dt.rgb *= mix( 1.0, 0.52 + 1.15 * d2l, 0.78 * detFade );
#endif

  // blade height proxy, straight off the sheet's own luminance: tips are bright,
  // roots are almost black, so this rides the real blade structure for free.
  float dh = clamp( dot( dt.rgb, vec3( 1.25, 1.95, 0.70 ) ), 0.0, 1.0 );

  vec3 grass = dt.rgb * mix( vec3( 1.0 ), mc.rgb * 2.0, 0.80 ) * uGrassGain;
  // 60 m variation: shear direction, wear and damp all pool at stadium scale, and
  // without it a procedural field reads as one tiled carpet however good the sheet is
  float pool = texture2D( uTMacro, P * 0.0165 + vec2( 0.37, 0.61 ) ).g;
  grass *= ( 0.80 + 0.42 * pool ) * vec3( 1.09, 1.0, 0.83 );
  grass = tfSat( grass, 1.14 );

  /* ------------------------------------------------------------ mow stripes */
  // Bands every 5 yards, boundary jittered by the macro sheet so it is a mown edge
  // and not a ruled one. The stripe is a real lean of the blades: it tilts the
  // normal, so the key light and the wet sheen both answer to it.
  float mowU = ( P.x + ( mc.r - 0.5 ) * 0.55 + ( dh - 0.5 ) * 0.16 ) / TF_MOW;
  float mowSign = mod( floor( mowU ), 2.0 ) * 2.0 - 1.0;
  float mowAmt = uMow * ( 0.7 + 0.3 * mc.g );
  float lean = -mowSign * V.x;
  grass *= 1.0 + mowAmt * ( 0.285 * mowSign + 0.130 * lean );

  /* ------------------------------------------------------------ the normal */
  vec3 N = vec3( 0.0, 1.0, 0.0 );
#if TURF_NORMALMAP
  vec3 nt = texture2D( uTDetailN, P * 0.826446 ).xyz * 2.0 - 1.0;
  N = normalize( mix( vec3( 0.0, 1.0, 0.0 ), normalize( vec3( nt.x, max( nt.z, 0.25 ), nt.y ) ), 0.85 * detFade ) );
#endif
  N = normalize( N + vec3( mowSign * 0.30 * mowAmt, 0.0, 0.0 ) );

  /* ---------------------------------------------------------------- damage */
  float torn = 0.0;
  float mud = 0.0;
  float wetBoost = 0.0;
  float dmgR = 0.0;
#if TURF_DAMAGE
  vec2 duv = ( P - uDamageWin.xy ) / ( uDamageWin.zw * 2.0 ) + 0.5;
  vec2 dcl = clamp( duv, 0.0, 1.0 );
  float inWin = step( 0.0, duv.x ) * step( duv.x, 1.0 ) * step( 0.0, duv.y ) * step( duv.y, 1.0 );
  vec4 dmg = texture2D( uTDamage, dcl ) * inWin;
  // break the decal edge with the blade sheet: a divot has a ragged border
  torn = clamp( ( dmg.r - 0.42 ) * 5.5 + 0.5 + ( dh - 0.5 ) * 0.9 + ( mc.b - 0.5 ) * 0.5, 0.0, 1.0 );
  torn *= smoothstep( 0.02, 0.16, dmg.r );
  mud = dmg.g;
  wetBoost = dmg.a;
  dmgR = dmg.r;
  N = normalize( N + vec3( ( dt.r - 0.5 ) * 0.9, 0.0, ( dt.b - 0.5 ) * 0.9 ) * dmg.b * torn * 0.45 );
#endif

  /* ----------------------------------------------------------- field paint */
  float wPx = fwx * 0.85;
  float wPz = fwz * 0.85;

  float inPlayX = step( ax, TF_GOAL_X - 0.06 );
  float onSurf  = step( ax, TF_END_X + 0.001 ) * step( az, TF_HALF_W + 0.001 );

  float yard = tfBand( tfRepeat( P.x, TF_MOW ), TF_LINE_HW, wPx ) * inPlayX * step( az, TF_HALF_W );
  float goal = tfBand( abs( ax - TF_GOAL_X ), TF_GOAL_HW, wPx ) * step( az, TF_HALF_W );
  float endl = tfBand( abs( ax - TF_END_X ), TF_LINE_HW, wPx ) * step( az, TF_HALF_W );
  float sidel = tfBand( abs( az - TF_HALF_W ), TF_LINE_HW, wPz ) * step( ax, TF_END_X );

  float xd = tfRepeat( P.x, TF_YD );
  float hashOnX = tfBand( xd, TF_HASH_HL, wPx );
  float hash = hashOnX * tfBand( abs( az - TF_HASH_Z ), TF_LINE_HW, wPz ) * inPlayX;

  // 1-yard ticks just inside each sideline
  float tickZ = smoothstep( TF_HALF_W - 0.64, TF_HALF_W - 0.60, az ) * ( 1.0 - smoothstep( TF_HALF_W - 0.05, TF_HALF_W - 0.01, az ) );
  float tick = tfBand( xd, TF_LINE_HW, wPx ) * tickZ * inPlayX;

  // ---- yard numerals -----------------------------------------------------
  float cx = floor( P.x / ( 10.0 * TF_YD ) + 0.5 ) * ( 10.0 * TF_YD );
  float sgn = P.y >= 0.0 ? 1.0 : -1.0;
  float lx = ( P.x - cx ) * sgn;
  float nv = ( az - TF_NUM_T ) / TF_NUM_H;
  float tens = floor( ( 50.0 - abs( cx ) / TF_YD ) * 0.1 + 0.5 );
  float uL = ( lx + TF_DIG_C ) / TF_DIG_W + 0.5;
  float uR = ( lx - TF_DIG_C ) / TF_DIG_W + 0.5;
  vec2 cell = vec2( 0.25, 0.3333333 );
  vec2 aL = ( vec2( mod( tens, 4.0 ), floor( tens * 0.25 ) ) + vec2( clamp( uL, 0.0, 1.0 ), clamp( nv, 0.0, 1.0 ) ) ) * cell;
  vec2 aR = ( vec2( 0.0, 0.0 ) + vec2( clamp( uR, 0.0, 1.0 ), clamp( nv, 0.0, 1.0 ) ) ) * cell;
  float insideL = step( 0.0, uL ) * step( uL, 1.0 );
  float insideR = step( 0.0, uR ) * step( uR, 1.0 );
  float insideV = step( 0.0, nv ) * step( nv, 1.0 );
  float numOK = step( abs( cx ), 36.6 ) * insideV * inPlayX;
  float digits = max( texture2D( uTNum, aL ).a * insideL, texture2D( uTNum, aR ).a * insideR ) * numOK;

  // ---- directional arrow -------------------------------------------------
  float gs = cx >= 0.0 ? 1.0 : -1.0;
  float axl = ( P.x - ( cx + gs * TF_ARR_O ) ) * gs;
  float azl = az - ( TF_NUM_T + TF_NUM_B ) * 0.5;
  float taper = clamp( ( TF_ARR_L * 0.5 - axl ) / TF_ARR_L, 0.0, 1.0 );
  float arrow = step( abs( axl ), TF_ARR_L * 0.5 ) * tfBand( abs( azl ), TF_ARR_HW * taper, wPz )
              * step( 1.0, abs( cx ) ) * step( abs( cx ), 36.6 ) * inPlayX;

  float paint = max( max( max( yard, goal ), max( endl, sidel ) ), max( max( hash, tick ), max( digits, arrow ) ) );
  paint *= onSurf;

  // solid 6-foot border outside the sidelines and end lines
  float bz = smoothstep( TF_HALF_W, TF_HALF_W + 0.05, az ) * ( 1.0 - smoothstep( TF_HALF_W + TF_BORDER - 0.12, TF_HALF_W + TF_BORDER, az ) );
  float bx = smoothstep( TF_END_X, TF_END_X + 0.05, ax ) * ( 1.0 - smoothstep( TF_END_X + TF_BORDER - 0.12, TF_END_X + TF_BORDER, ax ) );
  float border = max( bz, bx ) * step( az, TF_HALF_W + TF_BORDER ) * step( ax, TF_END_X + TF_BORDER );

  /* ------------------------------------------------------------- end zones */
  float ezM = uEZOn * smoothstep( TF_GOAL_X - 0.02, TF_GOAL_X + 0.04, ax ) * ( 1.0 - smoothstep( TF_END_X - 0.04, TF_END_X + 0.02, ax ) ) * step( az, TF_HALF_W );
  // inner border stripe in the secondary colour
  float ezIn = 1.0 - max(
    smoothstep( TF_END_X - 0.72, TF_END_X - 0.50, ax ),
    max( smoothstep( TF_HALF_W - 0.72, TF_HALF_W - 0.50, az ), 1.0 - smoothstep( TF_GOAL_X + 0.50, TF_GOAL_X + 0.72, ax ) )
  );
  vec3 ezCol = mix( uEZ1, uEZ0, ezIn );

  float sx2 = P.x >= 0.0 ? 1.0 : -1.0;
  float wu = ( P.y * sx2 + 13.0 ) / 26.0;
  float wv = 1.0 - ( ax - ( TF_GOAL_X + 1.40 ) ) / 6.50;
  vec4 wt = texture2D( uTWord, clamp( vec2( wu, wv ), 0.0, 1.0 ) );
  float wm = wt.a * step( 0.0, wu ) * step( wu, 1.0 ) * step( 0.0, wv ) * step( wv, 1.0 ) * ezM;

  /* ---------------------------------------------------------- midfield mark */
  vec2 cu = ( P + vec2( 4.7, 4.7 ) ) * 0.10638;
  vec4 ct = texture2D( uTCrest, clamp( cu, 0.0, 1.0 ) );
  float cm = ct.a * step( 0.0, cu.x ) * step( cu.x, 1.0 ) * step( 0.0, cu.y ) * step( cu.y, 1.0 ) * inPlayX;

  /* --------------------------------------------------------------- compose */
  vec3 albedo = grass;

  // end zone is painted turf: the blade structure still shows through the colour
  vec3 ezPaint = ezCol * ( 0.42 + 1.05 * dh ) * ( 0.72 + 0.52 * pool );
  albedo = mix( albedo, ezPaint, ezM * ( 0.80 + 0.15 * mc.g ) );
  albedo = mix( albedo, ct.rgb * 0.72, cm * 0.42 );
  albedo = mix( albedo, wt.rgb, wm * 0.88 );

  // paint wear: blades poke through, the edge is chipped, and the whole stripe
  // fades where it has been run over all night
  float wearN = clamp( dh * 0.55 + mc.r * 0.45, 0.0, 1.0 );
  float paintA = paint * clamp( 1.0 - uPaintWear * ( 1.0 - wearN ) * 1.55, 0.28, 1.0 ) * ( 0.58 + 0.42 * dh ) * clamp( 0.62 + 0.62 * mc.r, 0.35, 1.0 );
  float borderA = border * clamp( 1.0 - uPaintWear * ( 1.0 - wearN ) * 2.1, 0.12, 1.0 );
  vec3 paintCol = uPaintTint * ( 0.62 + 0.60 * wearN );
  albedo = mix( albedo, paintCol, max( paintA, borderA * 0.9 ) );

  // torn soil last: it destroys grass and paint alike
  vec3 soil = texture2D( uTSoil, P * 1.111 ).rgb;
  vec3 soilC = soil * ( 0.80 + 1.05 * mc.r ) * uSoilGain;
  albedo = mix( albedo, soilC, torn );
  // severed blades thrown clear of the gouge: a bright litter fringe, not a soft edge
  float litter = smoothstep( 0.08, 0.34, dmgR ) * ( 1.0 - smoothstep( 0.30, 0.75, torn ) ) * smoothstep( 0.44, 0.78, dh );
  albedo = mix( albedo, grass * 2.2, clamp( litter, 0.0, 1.0 ) * 0.8 );
  albedo *= 1.0 - 0.26 * mud;

  /* ------------------------------------------------------------- wet + rough */
  float wetMask = clamp( uWet * ( 0.52 + 0.55 * mc.g ) + wetBoost * 0.16, 0.0, 1.0 );
  albedo *= mix( 1.0, 0.56, wetMask );
  albedo = tfSat( albedo, 1.0 + 0.32 * wetMask );

  float rough = mix( 0.92, 0.135, wetMask );
  rough = mix( rough, rough * 0.62, max( paintA, borderA ) );
  rough = mix( rough, mix( 0.68, 0.40, wetMask ), torn );

  /* ------------------------------------------------- stadium bank reflection */
  vec3 spec = vec3( 0.0 );
  float rgh = max( 0.035, rough );
#if TURF_ANISO
  // Fibres lie along +-X (mown sideline to sideline), so the reflected bank is razor
  // thin across X and heavily smeared along Z — from a low sideline camera that is
  // exactly the long streak of light running away from you on a wet field.
  float rgX = max( 0.060, rgh * 0.62 * ( 1.0 - 0.22 * mowAmt ) );
  float rgZ = clamp( rgh * 1.25 + 0.21, 0.14, 0.85 );
#else
  float rgX = max( 0.10, rgh * 0.85 );
  float rgZ = rgX;
#endif
  float axr = rgX * rgX;
  float ayr = rgZ * rgZ;
  float NdV = max( dot( N, V ), 1e-4 );
  for ( int i = 0; i < TURF_BANKS; i++ ) {
    vec3 Lv = uBanks[ i ] - wp;
    float d2 = dot( Lv, Lv );
    vec3 L = Lv * inversesqrt( d2 );
    vec3 H = normalize( L + V );
    float NdH = max( dot( N, H ), 0.0 );
    float XdH = H.x;
    float ZdH = H.z;
    float dd = XdH * XdH / ( axr * axr ) + ZdH * ZdH / ( ayr * ayr ) + NdH * NdH;
    float D = 1.0 / ( 3.141593 * axr * ayr * dd * dd );
    float NdL = max( dot( N, L ), 0.0 );
    float F = 0.038 + 0.962 * pow( 1.0 - max( dot( H, V ), 0.0 ), 5.0 );
    spec += uBankColor * ( D * NdL * F ) / ( 1.0 + d2 * 0.00048 );
  }
  // grazing sky sheen — what makes the far half of a wet field read cool and glassy
  float fres = pow( 1.0 - NdV, 5.0 );
  spec += uSkyColor * fres * ( 0.22 + 0.55 * wetMask );
  // a wet field is PUDDLED, not varnished: break the reflection into patches or
  // the bank streaks read as projected beams instead of standing water
  spec *= uSheen * ( 0.16 + 1.45 * pow( clamp( mc.g * 0.75 + pool * 0.45, 0.0, 1.0 ), 1.7 ) ) * ( 0.35 + 0.9 * wetMask ) * ( 1.0 - 0.72 * torn );
  // soft shoulder, never a clamp: a hard clamp turns a reflected bank into a white
  // sticker with a cut edge, which is exactly what a bar critic spots first
  gTurfSpec = spec / ( 1.0 + spec * 0.85 );

  gTurfN = N;
  gTurfRough = clamp( rough, 0.05, 1.0 );

  // the surround: the field is not an infinite lit plate
  float apron = max(
    smoothstep( TF_HALF_W + TF_BORDER, TF_HALF_W + TF_BORDER + 2.4, az ),
    smoothstep( TF_END_X + TF_BORDER, TF_END_X + TF_BORDER + 2.4, ax )
  );
  float far = smoothstep( 34.0, 132.0, max( ax * 0.60, az ) );
  albedo = mix( albedo, vec3( 0.030, 0.034, 0.028 ), apron * 0.92 );
  albedo *= 1.0 - 0.93 * far;
  gTurfSpec *= 1.0 - apron * 0.9;
  gTurfRough = mix( gTurfRough, 0.82, apron );

  gTurfAlbedo = albedo;
}
`;

const FRAG_MAP = `
turfShade();
diffuseColor.rgb *= gTurfAlbedo;
`;

const FRAG_ROUGH = `
float roughnessFactor = gTurfRough;
`;

const FRAG_NORMAL = `
normal = normalize( ( viewMatrix * vec4( gTurfN, 0.0 ) ).xyz );
`;

const FRAG_TONE = `
gl_FragColor.rgb += gTurfSpec;
#include <tonemapping_fragment>
`;

/* --------------------------------------------------------------- the patch */

export function makeTurfMaterial(cfg, tex, uniforms) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.0,
    dithering: true,
  });
  mat.userData.turfUniforms = uniforms;
  mat.defines = {
    TURF_CLASS: cfg.cls,
    TURF_BANKS: Math.max(1, cfg.banks),
    TURF_NORMALMAP: cfg.normalMap ? 1 : 0,
    TURF_ANISO: cfg.aniso ? 1 : 0,
    TURF_DETAIL2: cfg.detail2 ? 1 : 0,
    TURF_DAMAGE: cfg.damage ? 1 : 0,
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_COMMON)
      .replace('#include <begin_vertex>', VERT_BODY);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', DEFS + '#include <common>\nvec3 gTurfAlbedo;\n' + FRAG_COMMON)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <tonemapping_fragment>', FRAG_TONE);
  };
  // force a distinct program per class so a rung change is a real rebuild, never a
  // silent no-op
  mat.customProgramCacheKey = () => `turf:${cfg.cls}:${cfg.banks}:${cfg.damage ? 1 : 0}`;
  return mat;
}

export default { makeTurfMaterial };
