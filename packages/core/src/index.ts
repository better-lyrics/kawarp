/**
 * Kawarp - Fluid Animated Background Renderer
 *
 * Creates a fluid, animated background effect similar to Apple Music's album art visualization.
 * Uses WebGL with Kawase blur and domain warping techniques.
 *
 * Optimized architecture:
 * - Blur runs on small textures (256x256) only when image changes
 * - Smooth crossfade transitions between images
 * - Per-frame work is minimal: just blend + warp + output
 */

export interface KawarpOptions {
  warpIntensity?: number;
  blurPasses?: number;
  animationSpeed?: number;
  transitionDuration?: number;
  saturation?: number;
}

interface Framebuffer {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

// Size for blur operations (small = fast)
const BLUR_SIZE = 128;

const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

const KAWASE_BLUR_SHADER = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform vec2 u_resolution;
  uniform float u_offset;
  varying vec2 v_texCoord;

  void main() {
    vec2 texelSize = 1.0 / u_resolution;
    vec4 color = vec4(0.0);

    color += texture2D(u_texture, v_texCoord + vec2(-u_offset, -u_offset) * texelSize);
    color += texture2D(u_texture, v_texCoord + vec2(u_offset, -u_offset) * texelSize);
    color += texture2D(u_texture, v_texCoord + vec2(-u_offset, u_offset) * texelSize);
    color += texture2D(u_texture, v_texCoord + vec2(u_offset, u_offset) * texelSize);

    gl_FragColor = color * 0.25;
  }
`;

// Blend shader for crossfading between two textures
const BLEND_SHADER = `
  precision mediump float;
  uniform sampler2D u_texture1;
  uniform sampler2D u_texture2;
  uniform float u_blend;
  varying vec2 v_texCoord;

  void main() {
    vec4 color1 = texture2D(u_texture1, v_texCoord);
    vec4 color2 = texture2D(u_texture2, v_texCoord);
    gl_FragColor = mix(color1, color2, u_blend);
  }
`;

const DOMAIN_WARP_SHADER = `
  precision mediump float;
  uniform sampler2D u_texture;
  uniform float u_time;
  uniform float u_intensity;
  varying vec2 v_texCoord;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vec2 uv = v_texCoord;
    float t = u_time * 0.05;

    vec2 center = uv - 0.5;
    float centerWeight = 1.0 - smoothstep(0.0, 0.7, length(center));

    // Large-scale movement (slow, big blobs)
    float n1 = snoise(uv * 0.35 + vec2(t, t * 0.7));
    float n2 = snoise(uv * 0.35 + vec2(-t * 0.8, t * 0.5) + vec2(50.0, 50.0));

    // Medium-scale detail (adds organic movement)
    float n3 = snoise(uv * 0.9 + vec2(t * 1.2, -t) + vec2(100.0, 0.0));
    float n4 = snoise(uv * 0.9 + vec2(-t, t * 1.1) + vec2(0.0, 100.0));

    // Combine two octaves
    vec2 warp = vec2(
      n1 * 0.65 + n3 * 0.35,
      n2 * 0.65 + n4 * 0.35
    ) * centerWeight;

    vec2 warpedUV = uv + warp * u_intensity;
    warpedUV = clamp(warpedUV, 0.0, 1.0);

    gl_FragColor = texture2D(u_texture, warpedUV);
  }
`;

const OUTPUT_SHADER = `
  precision mediump float;
  uniform sampler2D u_texture;
  uniform float u_saturation;
  varying vec2 v_texCoord;

  void main() {
    vec4 color = texture2D(u_texture, v_texCoord);

    vec2 center = v_texCoord - 0.5;
    float vignette = 1.0 - dot(center, center) * 0.3;
    color.rgb *= vignette;

    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(gray), color.rgb, u_saturation);

    gl_FragColor = color;
  }
`;

export class Kawarp {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;

  // Shader programs
  private blurProgram: WebGLProgram;
  private blendProgram: WebGLProgram;
  private warpProgram: WebGLProgram;
  private outputProgram: WebGLProgram;

  // Buffers
  private positionBuffer: WebGLBuffer;
  private texCoordBuffer: WebGLBuffer;

  // Source texture (original image)
  private sourceTexture: WebGLTexture;

  // Small FBOs for blur (BLUR_SIZE x BLUR_SIZE)
  private blurFBO1: Framebuffer;
  private blurFBO2: Framebuffer;

  // Album FBOs for crossfade (BLUR_SIZE x BLUR_SIZE)
  private currentAlbumFBO: Framebuffer;
  private nextAlbumFBO: Framebuffer;

  // Full-res FBO for warp output
  private warpFBO: Framebuffer;

  // Animation state
  private animationId: number | null = null;
  private startTime: number = Date.now();
  private isPlaying = false;

  // Transition state
  private isTransitioning = false;
  private transitionStartTime = 0;
  private _transitionDuration: number;

  // Options
  private _warpIntensity: number;
  private _blurPasses: number;
  private _animationSpeed: number;
  private _saturation: number;
  private hasImage = false;

  // Cached uniform locations
  private uniforms!: {
    blur: {
      resolution: WebGLUniformLocation;
      texture: WebGLUniformLocation;
      offset: WebGLUniformLocation;
    };
    blend: {
      texture1: WebGLUniformLocation;
      texture2: WebGLUniformLocation;
      blend: WebGLUniformLocation;
    };
    warp: {
      texture: WebGLUniformLocation;
      time: WebGLUniformLocation;
      intensity: WebGLUniformLocation;
    };
    output: { texture: WebGLUniformLocation; saturation: WebGLUniformLocation };
  };

  constructor(canvas: HTMLCanvasElement, options: KawarpOptions = {}) {
    this.canvas = canvas;

    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL not supported");
    this.gl = gl;

    this._warpIntensity = options.warpIntensity ?? 1.0;
    this._blurPasses = options.blurPasses ?? 8;
    this._animationSpeed = options.animationSpeed ?? 1.0;
    this._transitionDuration = options.transitionDuration ?? 1000;
    this._saturation = options.saturation ?? 1.5;

    // Create shader programs
    this.blurProgram = this.createProgram(VERTEX_SHADER, KAWASE_BLUR_SHADER);
    this.blendProgram = this.createProgram(VERTEX_SHADER, BLEND_SHADER);
    this.warpProgram = this.createProgram(VERTEX_SHADER, DOMAIN_WARP_SHADER);
    this.outputProgram = this.createProgram(VERTEX_SHADER, OUTPUT_SHADER);

    // Cache uniform locations
    this.uniforms = {
      blur: {
        resolution: gl.getUniformLocation(this.blurProgram, "u_resolution")!,
        texture: gl.getUniformLocation(this.blurProgram, "u_texture")!,
        offset: gl.getUniformLocation(this.blurProgram, "u_offset")!,
      },
      blend: {
        texture1: gl.getUniformLocation(this.blendProgram, "u_texture1")!,
        texture2: gl.getUniformLocation(this.blendProgram, "u_texture2")!,
        blend: gl.getUniformLocation(this.blendProgram, "u_blend")!,
      },
      warp: {
        texture: gl.getUniformLocation(this.warpProgram, "u_texture")!,
        time: gl.getUniformLocation(this.warpProgram, "u_time")!,
        intensity: gl.getUniformLocation(this.warpProgram, "u_intensity")!,
      },
      output: {
        texture: gl.getUniformLocation(this.outputProgram, "u_texture")!,
        saturation: gl.getUniformLocation(this.outputProgram, "u_saturation")!,
      },
    };

    // Create buffers
    this.positionBuffer = this.createBuffer(
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    );
    this.texCoordBuffer = this.createBuffer(
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
    );

    // Create source texture
    this.sourceTexture = this.createTexture();

    // Create small FBOs for blur operations
    this.blurFBO1 = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE);
    this.blurFBO2 = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE);

    // Create album FBOs for crossfade
    this.currentAlbumFBO = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE);
    this.nextAlbumFBO = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE);

    // Create full-res warp FBO (will be resized)
    this.warpFBO = this.createFramebuffer(1, 1);

    this.resize();
  }

  // Getters and setters
  get warpIntensity(): number {
    return this._warpIntensity;
  }
  set warpIntensity(value: number) {
    this._warpIntensity = Math.max(0, Math.min(1, value));
  }

  get blurPasses(): number {
    return this._blurPasses;
  }
  set blurPasses(value: number) {
    const newValue = Math.max(1, Math.min(40, Math.floor(value)));
    if (newValue !== this._blurPasses) {
      this._blurPasses = newValue;
      // Re-blur with new pass count if we have an image
      if (this.hasImage) {
        this.reblurCurrentImage();
      }
    }
  }

  get animationSpeed(): number {
    return this._animationSpeed;
  }
  set animationSpeed(value: number) {
    this._animationSpeed = Math.max(0.1, Math.min(5, value));
  }

  get transitionDuration(): number {
    return this._transitionDuration;
  }
  set transitionDuration(value: number) {
    this._transitionDuration = Math.max(0, Math.min(5000, value));
  }

  get saturation(): number {
    return this._saturation;
  }
  set saturation(value: number) {
    this._saturation = Math.max(0, Math.min(3, value));
  }

  setOptions(options: Partial<KawarpOptions>): void {
    if (options.warpIntensity !== undefined)
      this.warpIntensity = options.warpIntensity;
    if (options.blurPasses !== undefined) this.blurPasses = options.blurPasses;
    if (options.animationSpeed !== undefined)
      this.animationSpeed = options.animationSpeed;
    if (options.transitionDuration !== undefined)
      this.transitionDuration = options.transitionDuration;
    if (options.saturation !== undefined) this.saturation = options.saturation;
  }

  getOptions(): Required<KawarpOptions> {
    return {
      warpIntensity: this._warpIntensity,
      blurPasses: this._blurPasses,
      animationSpeed: this._animationSpeed,
      transitionDuration: this._transitionDuration,
      saturation: this._saturation,
    };
  }

  // Image loading methods
  loadImage(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
        this.gl.texImage2D(
          this.gl.TEXTURE_2D,
          0,
          this.gl.RGBA,
          this.gl.RGBA,
          this.gl.UNSIGNED_BYTE,
          img,
        );
        this.processNewImage();
        resolve();
      };
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      img.src = src;
    });
  }

  loadImageElement(source: TexImageSource): void {
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      source,
    );
    this.processNewImage();
  }

  loadImageData(
    data: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
  ): void {
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      width,
      height,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      data instanceof Uint8ClampedArray ? new Uint8Array(data.buffer) : data,
    );
    this.processNewImage();
  }

  loadFromImageData(imageData: ImageData): void {
    this.loadImageData(imageData.data, imageData.width, imageData.height);
  }

  async loadBlob(blob: Blob): Promise<void> {
    const bitmap = await createImageBitmap(blob);
    this.loadImageElement(bitmap);
    bitmap.close();
  }

  loadBase64(base64: string): Promise<void> {
    const src = base64.startsWith("data:")
      ? base64
      : `data:image/png;base64,${base64}`;
    return this.loadImage(src);
  }

  async loadArrayBuffer(
    buffer: ArrayBuffer,
    mimeType = "image/png",
  ): Promise<void> {
    const blob = new Blob([buffer], { type: mimeType });
    return this.loadBlob(blob);
  }

  loadGradient(colors: string[], angle = 135): void {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const angleRad = (angle * Math.PI) / 180;
    const x1 = size / 2 - Math.cos(angleRad) * size;
    const y1 = size / 2 - Math.sin(angleRad) * size;
    const x2 = size / 2 + Math.cos(angleRad) * size;
    const y2 = size / 2 + Math.sin(angleRad) * size;

    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    colors.forEach((color, i) => {
      gradient.addColorStop(i / (colors.length - 1), color);
    });

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    this.loadImageElement(canvas);
  }

  /**
   * Process a new image: blur it and start transition
   * This is the key optimization - blur only runs here, not every frame!
   */
  private processNewImage(): void {
    const gl = this.gl;

    // Swap album FBOs - current becomes the "from", we'll render "to" into next
    [this.currentAlbumFBO, this.nextAlbumFBO] = [
      this.nextAlbumFBO,
      this.currentAlbumFBO,
    ];

    // Blur into nextAlbumFBO
    this.blurSourceInto(this.nextAlbumFBO);

    // Mark that we have an image
    this.hasImage = true;

    // Start transition
    this.isTransitioning = true;
    this.transitionStartTime = Date.now();
  }

  /**
   * Re-blur the current image (used when blurPasses changes)
   * Updates nextAlbumFBO in place without starting a transition
   */
  private reblurCurrentImage(): void {
    this.blurSourceInto(this.nextAlbumFBO);
  }

  /**
   * Blur the source texture into the target FBO
   */
  private blurSourceInto(targetFBO: Framebuffer): void {
    const gl = this.gl;

    gl.useProgram(this.blurProgram);
    this.setupAttributes(this.blurProgram);
    gl.uniform2f(this.uniforms.blur.resolution, BLUR_SIZE, BLUR_SIZE);
    gl.uniform1i(this.uniforms.blur.texture, 0);
    gl.activeTexture(gl.TEXTURE0);

    let readFBO = this.blurFBO1;
    let writeFBO = this.blurFBO2;

    // Kawase blur passes on small texture
    for (let i = 0; i < this._blurPasses; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO.framebuffer);
      gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);
      gl.bindTexture(
        gl.TEXTURE_2D,
        i === 0 ? this.sourceTexture : readFBO.texture,
      );
      gl.uniform1f(this.uniforms.blur.offset, i + 0.5);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      [readFBO, writeFBO] = [writeFBO, readFBO];
    }

    // Copy final blur result to target FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO.framebuffer);
    gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);
    gl.bindTexture(gl.TEXTURE_2D, readFBO.texture);
    gl.uniform1f(this.uniforms.blur.offset, 0.0); // No offset = just copy
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  resize(): void {
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Only warpFBO needs to be canvas size
    if (this.warpFBO) this.deleteFramebuffer(this.warpFBO);
    this.warpFBO = this.createFramebuffer(width, height);
  }

  start(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.startTime = Date.now();
    this.renderLoop();
  }

  stop(): void {
    this.isPlaying = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  renderFrame(time?: number): void {
    const t =
      time ?? ((Date.now() - this.startTime) / 1000) * this._animationSpeed;
    this.render(t);
  }

  dispose(): void {
    this.stop();
    const gl = this.gl;

    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.blendProgram);
    gl.deleteProgram(this.warpProgram);
    gl.deleteProgram(this.outputProgram);

    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.texCoordBuffer);
    gl.deleteTexture(this.sourceTexture);

    this.deleteFramebuffer(this.blurFBO1);
    this.deleteFramebuffer(this.blurFBO2);
    this.deleteFramebuffer(this.currentAlbumFBO);
    this.deleteFramebuffer(this.nextAlbumFBO);
    this.deleteFramebuffer(this.warpFBO);
  }

  private renderLoop = (): void => {
    if (!this.isPlaying) return;
    const time = ((Date.now() - this.startTime) / 1000) * this._animationSpeed;
    this.render(time);
    this.animationId = requestAnimationFrame(this.renderLoop);
  };

  /**
   * Main render loop - very efficient!
   * Just: blend album FBOs → domain warp → output
   */
  private render(time: number): void {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Calculate transition blend factor
    let blendFactor = 1.0;
    if (this.isTransitioning) {
      const elapsed = Date.now() - this.transitionStartTime;
      blendFactor = Math.min(1.0, elapsed / this._transitionDuration);
      if (blendFactor >= 1.0) {
        this.isTransitioning = false;
      }
    }

    // Step 1: Blend album FBOs (or use current if not transitioning)
    let blendedTexture: WebGLTexture;

    if (this.isTransitioning && blendFactor < 1.0) {
      // Blend current → next into warpFBO temporarily
      gl.useProgram(this.blendProgram);
      this.setupAttributes(this.blendProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.warpFBO.framebuffer);
      gl.viewport(0, 0, width, height);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.currentAlbumFBO.texture);
      gl.uniform1i(this.uniforms.blend.texture1, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.nextAlbumFBO.texture);
      gl.uniform1i(this.uniforms.blend.texture2, 1);

      gl.uniform1f(this.uniforms.blend.blend, blendFactor);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      blendedTexture = this.warpFBO.texture;

      // Now warp the blended result - render to screen via output
      gl.useProgram(this.warpProgram);
      this.setupAttributes(this.warpProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, blendedTexture);
      gl.uniform1i(this.uniforms.warp.texture, 0);
      gl.uniform1f(this.uniforms.warp.time, time);
      gl.uniform1f(this.uniforms.warp.intensity, this._warpIntensity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else {
      // No transition - just warp the current album directly
      gl.useProgram(this.warpProgram);
      this.setupAttributes(this.warpProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.warpFBO.framebuffer);
      gl.viewport(0, 0, width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.nextAlbumFBO.texture);
      gl.uniform1i(this.uniforms.warp.texture, 0);
      gl.uniform1f(this.uniforms.warp.time, time);
      gl.uniform1f(this.uniforms.warp.intensity, this._warpIntensity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Output with vignette and saturation
      gl.useProgram(this.outputProgram);
      this.setupAttributes(this.outputProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.bindTexture(gl.TEXTURE_2D, this.warpFBO.texture);
      gl.uniform1i(this.uniforms.output.texture, 0);
      gl.uniform1f(this.uniforms.output.saturation, this._saturation);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  private setupAttributes(program: WebGLProgram): void {
    const gl = this.gl;
    const posLoc = gl.getAttribLocation(program, "a_position");
    const texLoc = gl.getAttribLocation(program, "a_texCoord");

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);
  }

  private createShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to create shader");

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${error}`);
    }
    return shader;
  }

  private createProgram(
    vertexSource: string,
    fragmentSource: string,
  ): WebGLProgram {
    const gl = this.gl;
    const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.createShader(
      gl.FRAGMENT_SHADER,
      fragmentSource,
    );

    const program = gl.createProgram();
    if (!program) throw new Error("Failed to create program");

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link error: ${error}`);
    }

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return program;
  }

  private createBuffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Failed to create buffer");

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to create texture");

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  private createFramebuffer(width: number, height: number): Framebuffer {
    const gl = this.gl;
    const texture = this.createTexture();
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error("Failed to create framebuffer");

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    return { framebuffer, texture };
  }

  private deleteFramebuffer(fbo: Framebuffer): void {
    this.gl.deleteFramebuffer(fbo.framebuffer);
    this.gl.deleteTexture(fbo.texture);
  }
}

export default Kawarp;
