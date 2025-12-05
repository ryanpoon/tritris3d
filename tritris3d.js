// tritris3d.js
// Ryan Poon (rpoon01)
// CS 175 - Final Project
// Standalone Three.js renderer for Tritris.
// Uses the existing game/grid/piece data and renders every triangle as a 3D-lit flat tri.

// Global handle used from sketch.js
let threeRenderer = null;


// Called once after assets are loaded (from finishedLoading in sketch.js)
function initThreeRenderer() {
    if (typeof THREE === 'undefined') {
        console.error('THREE is not available. Did you include the Three.js script in index.html?');
        return;
    }
    threeRenderer = new ThreeTritrisRenderer();
}

// Called every frame from draw() when gameState is INGAME or PAUSED
function renderThreeFromGame(game, paused) {
    if (!threeRenderer || !game) return;
    
    if (game.tritrisJustHappened) {
        threeRenderer.triggerLightshow();
        game.tritrisJustHappened = false;
    }
    // detect when line animation begins
    if (game.animatingLines && game.animatingLines.length > 0 && !threeRenderer.lineClearActive) {
        threeRenderer.triggerLineClear(game.animatingLines);
        threeRenderer.lineClearActive = true; 
    }

    // detect when the default animation ends
    if (threeRenderer.lineClearActive && game.animatingLines.length === 0) {
        threeRenderer.lineClearActive = false;  
    }


    threeRenderer.updateFromGame(game, paused);
    threeRenderer.render();
}

// called every frame from draw() when gameState is MENU
function renderThreeMenu(lastScore, highScore, selectionIndex) {
    if (!threeRenderer) return;
    
    if (threeRenderer.gridGroup.children.length === 0) {
        threeRenderer._createGridLines();
    }

    const currentLvl = parseInt(select('#level').value()) || 0;

    threeRenderer.showMenuUI(currentLvl, lastScore, highScore, selectionIndex);
    threeRenderer.stars.rotation.y += 0.0003; 
    threeRenderer.render();
}
class ThreeTritrisRenderer {
    constructor() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x2e2d2d);

        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);

        // Board centered around (0,0,0) in XY plane, camera in +Z looking toward origin.
        // Put the camera up/right and forward a bit, looking toward center.
        this.camera.position.set(0, 2, 32);   // centered left/right, above the board, forward
        this.camera.lookAt(0, 0, 0);           // look at middle of board
        this.camera.up.set(0, 1, 0);     

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false
        });
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        this.renderer.domElement.style.position = 'fixed';
        this.renderer.domElement.style.left = '0';
        this.renderer.domElement.style.top = '0';
        this.renderer.domElement.style.zIndex = '0';
        // Allow p5 canvas & DOM to receive input normally
        this.renderer.domElement.style.pointerEvents = 'none';

        document.body.appendChild(this.renderer.domElement);

        //  lights 
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);

        const key = new THREE.PointLight(0x88aaff, 5, 200);
        key.position.set(20, 30, 40);
        this.scene.add(key);

        const rim = new THREE.PointLight(0xff66cc, 1.2, 200);
        rim.position.set(-25, -20, 30);
        this.scene.add(rim);

        // materials
        this.gridMaterial = new THREE.LineBasicMaterial({
            color: 0x44aaff,
            transparent: true,
            opacity: 0.35,
        });

        // particle geometries
        this.particleGeo = new THREE.PlaneGeometry(0.2, 0.02);
        this.shockwaveGeo = new THREE.RingGeometry(0.01, 0.12, 32);

        //  groups for different sets of meshes 
        this.boardGroup = new THREE.Group();
        this.boardGroup.name = 'BoardGroup3D';
        this.scene.add(this.boardGroup);

        this.activeGroup = new THREE.Group();
        this.activeGroup.name = 'ActivePiece3D';
        this.scene.add(this.activeGroup);

        this.nextPieceGroup = new THREE.Group();
        this.nextPieceGroup.name = 'NextPiece3D';
        this.scene.add(this.nextPieceGroup);

        this.uiGroup = new THREE.Group();
        this.scene.add(this.uiGroup);

        this.gridGroup = new THREE.Group();
        this.scene.add(this.gridGroup);

        this.particleGroup = new THREE.Group();
        this.scene.add(this.particleGroup);
        this.particles = [];


        // Board dimensions 
        this.boardWidth = 8;
        this.boardHeight = 16;
        this.cellSize = 1.4;

        this.bounceTime = 0;
        this.bounceDuration = 0.15; 
        this.bounceHeight = 0.70;  

        this.starRotDir = 1.0; 

        // Colors by triangle color index, mirroring Game.colors order. 
        this.colors = [
            0xff0000, // Red boomerang
            0x00ff00, // Green fortune cookie
            0xffff00, // Yellow pencil
            0xff00ff, // Pink boomerang
            0x00ffff, // Blue pencil
            0xfa6419, // Orange Razor
            0xffffff  // White Ninja
        ];

        // materials caches for locked and active triangles
        this.materialsCache = this.colors.map(c => 
            new THREE.MeshStandardMaterial({
                color: c,
                emissive: c,
                emissiveIntensity: 0.65,
                metalness: 0.15,
                roughness: 0.45,
                transparent: true,
                opacity: 0.55,
                side: THREE.DoubleSide
            })
        );
        this.activeMaterialsCache = this.colors.map(c => 
            new THREE.MeshStandardMaterial({
                color: c,
                emissive: c,
                emissiveIntensity: 1.6,
                metalness: 0.2,
                roughness: 0.2,
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide
            })
        );

        // Geometry cache: key 'row_col' -> BufferGeometry
        this.triGeometryCache = {};
        this.localTriangles = this._buildLocalTriangleDefs();

        // previous locked cells for placement particle effects
        this.prevLocked = new Set();

        //this._addBoardFrame();

        window.addEventListener('resize', () => this._onResize());
        this._onResize();
        this._createStarfield();

        
    }

    showMenuUI(currentLevel, lastScore, highScore, selectionIndex) {
        if (this.uiGroup.userData.isMenu) {
            if (this.uiGroup.userData.lastLevel !== currentLevel ||
                this.uiGroup.userData.lastSelection !== selectionIndex ||
                this.uiGroup.userData.lastSpin !== settings.spinNextPiece ||
                this.uiGroup.userData.lastSound !== settings.soundEnabled) {
                
                this._clearGroup(this.uiGroup); 
                this.uiGroup.userData.isMenu = false; 
            } else {
                return;
            }
        }

        this._clearGroup(this.uiGroup);
        this._clearGroup(this.nextPieceGroup);
        this._clearGroup(this.activeGroup);

        // main title
        const titleSprite = this._makeTextSprite("TRITRIS 3D", {
            fontSize: 120,
            textColor: '#00ffff',
            glowColor: '#00aaaa',
            scale: 0.025
        });
        titleSprite.position.set(-8, 6, 10); 

        // level selector (idx 0)
        const lvlColor = (selectionIndex === 0) ? '#ffcc00' : '#00ffff'; 
        const lvlGlow = (selectionIndex === 0) ? '#ffcc00' : '#00ffff';
        const levelSprite = this._makeTextSprite(`Start Level: ${currentLevel}`, {
            fontSize: 70,
            textColor: lvlColor,
            glowColor: lvlGlow,
            scale: 0.018
        });
        levelSprite.position.set(-4, 1.5, 10);

        // spin checkbox (idx 1)
        const spinColor = (selectionIndex === 1) ? '#ffcc00' : '#00ffff'; 
        const spinText = settings.spinNextPiece ? "[X] Spin Next Piece" : "[ ] Spin Next Piece";
        const spinSprite = this._makeTextSprite(spinText, {
            fontFace: 'Courier New',
            fontSize: 60,
            textColor: spinColor,
            scale: 0.015
        });
        spinSprite.position.set(-5, 0, 10);

        // sound checkbox (idx 2)
        const soundColor = (selectionIndex === 2) ? '#ffcc00' : '#00ffff'; 
        const soundText = settings.soundEnabled ? "[X] Sound Enabled" : "[ ] Sound Enabled";
        const soundSprite = this._makeTextSprite(soundText, {
            fontFace: 'Courier New',
            fontSize: 60, 
            textColor: soundColor, 
            scale: 0.015
        });
        soundSprite.position.set(-5, -0.8, 10); 
        
        const controlsSprite = this._makeTextSprite("Select options with Up/Down and adjust with Left/Right", {
            fontSize: 40,
            textColor: '#aaaaaa',
            scale: 0.012
        });
        controlsSprite.position.set(-5, -2.5, 10);
        
        // high Score
        const hsSprite = this._makeTextSprite(`High Score: ${highScore || 0}`, {
            fontFace: 'Courier New',
            fontSize: 50,
            textColor: '#00ff00',
            scale: 0.015
        });
        hsSprite.position.set(4, 3, 10);

        // previous Score
        const lsSprite = this._makeTextSprite(`Last Score: ${lastScore || 0}`, {
            fontFace: 'Courier New',
            fontSize: 50,
            textColor: '#cccccc',
            scale: 0.015
        });
        lsSprite.position.set(4, 4, 10);

        // credits
        const creditsSprite = this._makeTextSprite("Made by Ryan Poon for CS 175", {
            fontFace: 'Verdana',
            fontSize: 40,
            textColor: '#f6e41cff',
            scale: 0.012
        });
        creditsSprite.position.set(-13, -6, 10);

        const creditsSprite2 = this._makeTextSprite("Built off of Tritris, made by Leo Gagnon", {
            fontFace: 'Verdana',
            fontSize: 40,
            textColor: '#f6e41cff',
            scale: 0.012
        });
        creditsSprite2.position.set(-13, -7, 10);
        
        

        // start Instruction 
        const startSprite = this._makeTextSprite("PRESS ENTER TO START", {
            fontSize: 60,
            textColor: '#ffffff',
            glowColor: '#ffffff',
            scale: 0.015
        });
        startSprite.position.set(-5, -6, 10);
        

        this.uiGroup.add(titleSprite, levelSprite, spinSprite, soundSprite, 
            lsSprite, hsSprite, controlsSprite, creditsSprite, startSprite,
            creditsSprite2);
        this.uiGroup.userData.isMenu = true;
        this.uiGroup.userData.lastLevel = currentLevel;
        this.uiGroup.userData.lastSelection = selectionIndex;
        this.uiGroup.userData.lastSpin = settings.spinNextPiece;
        this.uiGroup.userData.lastSound = settings.soundEnabled;
    }

    _updateMenuLevelText(level) {
        if (!this.levelSprite) return;
        
        const newSprite = this._makeTextSprite(`Level: ${level}`, {
            fontSize: 70,
            textColor: '#ffcc00',
            glowColor: '#ffaa00',
            scale: 0.018
        });
        
        this.levelSprite.material.dispose();
        this.levelSprite.material = newSprite.material;
        this.levelSprite.scale.copy(newSprite.scale);
    }

    _onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    // messed with adding a board frame, but decided against it for now
    _addBoardFrame() {
        const w = this.boardWidth * this.cellSize;
        const h = this.boardHeight * this.cellSize;

        const geometry = new THREE.PlaneGeometry(w + 0.6, h + 0.6);
        const material = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.5
        });

        const frame = new THREE.Mesh(geometry, material);
        frame.position.set(0, 0, -0.1); // slightly behind triangles
        this.scene.add(frame);
    }

    // define triangle corners local to the center of a cell.
    // cell center is (0,0); each cell is cellSize x cellSize.
    // mirror the four sub-triangles used in Triangle.show. 
    _buildLocalTriangleDefs() {
        const s = this.cellSize;
        const h = s / 2;

        const TL = { x: -h, y:  h };
        const TR = { x:  h,  y:  h };
        const BL = { x: -h, y: -h };
        const BR = { x:  h,  y: -h };

        return {
            "0_0": [ TL, TR, BL ],   // top-left
            "0_1": [ TR, BR, TL ],   // top-right
            "1_0": [ BL, TL, BR ],   // bottom-left
            "1_1": [ BR, BL, TR ]    // bottom-right
        };
    }


    _getTriangleGeometry(subRow, subCol) {
        const key = `prism_${subRow}_${subCol}`;
        if (this.triGeometryCache[key]) return this.triGeometryCache[key];

        // Get the 2D triangle vertices 
        const verts = this.localTriangles[`${subRow}_${subCol}`];
        if (!verts) return null;

        // Convert local verts to array form for easy reuse
        const A = new THREE.Vector3(verts[0].x, verts[0].y, 0);
        const B = new THREE.Vector3(verts[1].x, verts[1].y, 0);
        const C = new THREE.Vector3(verts[2].x, verts[2].y, 0);

        // Extrude into a triangular prism 
        const depth = 1.10;           // thickness of pieces
        const half = depth / 2;

        // Front face Z
        const A1 = A.clone().setZ(+half);
        const B1 = B.clone().setZ(+half);
        const C1 = C.clone().setZ(+half);

        // Back face Z
        const A2 = A.clone().setZ(-half);
        const B2 = B.clone().setZ(-half);
        const C2 = C.clone().setZ(-half);

        // 12 triangles = 36 vertices :C
        const geom = new THREE.BufferGeometry();
        const verts3 = [];

        function tri(v1, v2, v3) {
            verts3.push(
                v1.x, v1.y, v1.z,
                v2.x, v2.y, v2.z,
                v3.x, v3.y, v3.z
            );
        }

        // FRONT (A1,B1,C1)
        tri(A1, B1, C1);

        // BACK (C2,B2,A2)
        tri(C2, B2, A2);

        // SIDES
        tri(A1, A2, B1);
        tri(B1, A2, B2);

        tri(B1, B2, C1);
        tri(C1, B2, C2);

        tri(C1, C2, A1);
        tri(A1, C2, A2);

        const arr = new Float32Array(verts3);
        geom.setAttribute("position", new THREE.BufferAttribute(arr, 3));
        geom.computeVertexNormals();

        this.triGeometryCache[key] = geom;
        return geom;
    }

    _clearGroup(group) {
        // Remove all children and dispose ONLY materials.
        while (group.children.length > 0) {
            const child = group.children[0];
            group.remove(child);

            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        }
    }

    _makeTextSprite(text, options = {}) {
        const fontFace = options.fontFace || 'Orbitron';  
        const fontSize = options.fontSize || 72;
        const textColor = options.textColor || '#ffffff';
        const outlineColor = options.outlineColor || '#00aaff';
        const glowColor = options.glowColor || outlineColor;
        const scale = options.scale || 0.018;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        ctx.font = `${fontSize}px ${fontFace}`;
        const metrics = ctx.measureText(text);
        const padding = 40;

        canvas.width = metrics.width + padding * 2;
        canvas.height = fontSize + padding * 2;

        ctx.font = `${fontSize}px ${fontFace}`;
        ctx.textAlign = options.textAlign || 'left';
        ctx.textBaseline = 'middle';

        // glow
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = fontSize * 0.35;

        // outline
        ctx.lineWidth = fontSize * 0.12;
        ctx.strokeStyle = outlineColor;
        ctx.strokeText(text, padding, canvas.height / 2);

        // fill
        ctx.fillStyle = textColor;
        ctx.fillText(text, padding, canvas.height / 2);

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        
        const material = new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthTest: false
        });

        const sprite = new THREE.Sprite(material);
        sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
        if (!options.textAlign) {
            sprite.center.set(0, 0.5);
        } 

        return sprite;
    }



    _updateUI(game, paused) {
        // Clear previous UI
        while (this.uiGroup.children.length > 0) {
            const c = this.uiGroup.children.pop();
            if (c.material && c.material.map) c.material.map.dispose();
            if (c.material) c.material.dispose();
        }

        if (!game) return;

        if (this.lastScore === game.score && 
            this.lastLines === game.lines && 
            this.lastLevel === game.level &&
            this.lastPaused === paused) {
            return;
        }

        let triPercent = 0;
        if (game.lines > 0) {
            triPercent = Math.round((3 * game.tritrisAmt / game.lines) * 100);
        }

        // Score / lines / level text
        const scoreText = `Score: ${game.score}`;
        const linesText = `Lines: ${game.lines}`;
        const levelText = `Level: ${game.level}`;
        const percentText = `Tri %: ${triPercent}`;

        const scoreSprite = this._makeTextSprite(scoreText, {
            fontFace: 'Courier New',
            fontSize: 56,
            scale: 0.015
        });
        const linesSprite = this._makeTextSprite(linesText, {
            fontFace: 'Courier New',
            fontSize: 56,
            scale: 0.015
        });
        const levelSprite = this._makeTextSprite(levelText, {
            fontFace: 'Courier New',
            fontSize: 56,
            scale: 0.015
        });
        const percentSprite = this._makeTextSprite(percentText, { 
            fontFace: 'Courier New',
            fontSize: 56, 
            scale: 0.015,
        });

        // Position the UI to the right of the board in world space
        const baseX = (this.boardWidth / 2 + 1.0) * this.cellSize;
        const baseY = (this.boardHeight / 2 - 1.5) * this.cellSize;
        const z = 0.6;

        scoreSprite.position.set(baseX, baseY, z);
        linesSprite.position.set(baseX, baseY - this.cellSize * 1.0, z);
        levelSprite.position.set(baseX, baseY - this.cellSize * 2.0, z);
        percentSprite.position.set(baseX, baseY - this.cellSize * 7.0, z);

        this.uiGroup.add(scoreSprite, linesSprite, levelSprite, percentSprite);
        
        if (paused) {
            const pausedSprite = this._makeTextSprite('PAUSED', {
                fontSize: 96,
                textColor: '#ffcc00',
                bgColor: 'rgba(0,0,0,0.7)',
                scale: 0.02,
                textAlign: 'left'
            });
            pausedSprite.position.set(0, 0, 1.0);
            this.uiGroup.add(pausedSprite);
        }
    }


    updateFromGame(game, paused) {
        this.uiGroup.userData.isMenu = false;
        const currentLocked = new Set();
        const newlyLocked = [];
        this.boardWidth = game.w;
        this.boardHeight = game.h;

        // Clear old meshes
        this._clearGroup(this.boardGroup);
        this._clearGroup(this.activeGroup);
        this._clearGroup(this.nextPieceGroup);

        //  LOCKED GRID 
        const grid = game.grid.grid;
        if (!paused) {
            for (let row = 0; row < game.h; row++) {
                for (let col = 0; col < game.w; col++) {
                    const cell = grid[row][col];
                    if (!cell || !cell.tris) continue;

                    for (let subRow = 0; subRow < 2; subRow++) {
                        for (let subCol = 0; subCol < 2; subCol++) {
                            const tri = cell.tris[subRow][subCol];
                            if (!tri) continue;

                            const colorIndex = tri.clr; 
                            const key = `${row},${col},${subRow},${subCol}`;
                            currentLocked.add(key);

                            if (!this.prevLocked.has(key)) {
                                newlyLocked.push({ row, col, subRow, subCol, clr: colorIndex });
                                if (newlyLocked.length == 1) {
                                    sfx.play("lock", Math.random() * 400 + 600);
                                    this.startBoardBounce();
                                }

                            }

                            this._addTriangleMesh(
                                this.boardGroup,
                                col,
                                row,
                                subRow,
                                subCol,
                                colorIndex,
                                false
                            );
                        }
                    }
                }
            }
        }
        // spawn placement particles and shockwave for newly locked cells
        if (newlyLocked.length < 4){
            for (const cell of newlyLocked) {
                const worldX = (cell.col - this.boardWidth / 2 + 0.5) * this.cellSize;
                const worldY = (this.boardHeight / 2 - cell.row - 0.5) * this.cellSize;
                const colorHex = this.colors[cell.clr];

                this.spawnParticles(worldX, worldY, colorHex);
                this.spawnShockwave(worldX, worldY, colorHex);
            }
        }
        this.prevLocked = currentLocked


        //  ACTIVE FALLING PIECE 
        if (!paused && game.currentPiece) {
            const p = game.currentPiece; // Piece instance 
            for (let row = 0; row < p.grid.length; row++) {
                for (let col = 0; col < p.grid[0].length; col++) {
                    const cell = p.grid[row][col];
                    if (!cell || !cell.tris) continue;

                    for (let subRow = 0; subRow < 2; subRow++) {
                        for (let subCol = 0; subCol < 2; subCol++) {
                            const tri = cell.tris[subRow][subCol];
                            if (!tri) continue;

                            const worldRow = row + p.pos.y;
                            const worldCol = col + p.pos.x;

                            this._addTriangleMesh(
                                this.activeGroup,
                                worldCol,
                                worldRow,
                                subRow,
                                subCol,
                                tri.clr,
                                true
                            );
                        }
                    }
                }
            }
        }
        this._updateNextPiece(game);
        this._updateUI(game, paused);
        this._createGridLines();
    }

    _updateNextPiece(game) {
        const np = game.nextPiece;
        if (!np) return;

        const rows = np.grid.length;
        const cols = np.grid[0].length;

        // compute bounding box of used cells for centering
        let minR = Infinity, maxR = -Infinity;
        let minC = Infinity, maxC = -Infinity;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = np.grid[r][c];
                if (!cell || !cell.tris) continue;

                let has = false;
                for (let sr = 0; sr < 2; sr++) {
                    for (let sc = 0; sc < 2; sc++) {
                        if (cell.tris[sr][sc]) has = true;
                    }
                }
                if (!has) continue;

                minR = Math.min(minR, r);
                maxR = Math.max(maxR, r);
                minC = Math.min(minC, c);
                maxC = Math.max(maxC, c);
            }
        }

        if (!isFinite(minR)) return; // empty piece, bail

        const pieceW = maxC - minC + 1;
        const pieceH = maxR - minR + 1;

        // where the preview should appear in world space
        const previewCenterX = (this.boardWidth / 2 + 2.5) * this.cellSize;
        const previewCenterY = (this.boardHeight / 2 - 6) * this.cellSize;

        // create a fresh pivot group for this frame 
        const pivot = new THREE.Group();
        this.nextPieceGroup.add(pivot);
        this.nextPiecePivot = pivot;   // remember for rotation in render()

        // glowing box around the piece 
        const glowSizeX = 1.5 * this.cellSize + 1.5;
        const glowSizeY = 1.5 * this.cellSize + 1.5;
        const glowSizeZ = 1.5 * this.cellSize + 1.5

        const glowGeo = new THREE.BoxGeometry(glowSizeX, glowSizeY, glowSizeZ);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0x88ccff,
            transparent: true,
            opacity: 0.25
        });

        const glowMesh = new THREE.Mesh(glowGeo, glowMat);
        this.nextPieceGroup.add(glowMesh);
        this.nextPieceGlow = glowMesh;
        glowMesh.position.set(previewCenterX, previewCenterY, 0.3);
        glowMesh.rotation.y = -0.2;

        // add all triangles as children of the pivot 
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = np.grid[r][c];
                if (!cell || !cell.tris) continue;

                for (let sr = 0; sr < 2; sr++) {
                    for (let sc = 0; sc < 2; sc++) {
                        const tri = cell.tris[sr][sc];
                        if (!tri) continue;

                        const geom = this._getTriangleGeometry(sr, sc);
                        const color = this.colors[tri.clr];

                        const mat = new THREE.MeshStandardMaterial({
                            color,
                            emissive: color,
                            emissiveIntensity: 1.4,
                            metalness: 0.3,
                            roughness: 0.25,
                            side: THREE.DoubleSide
                        });

                        const mesh = new THREE.Mesh(geom, mat);

                        // local offset relative to pivot center
                        const cx = (c - minC - pieceW / 2 + 0.5) * this.cellSize;
                        const cy = -(r - minR - pieceH / 2 + 0.5) * this.cellSize;

                        mesh.position.set(cx, cy, 0.25);
                        pivot.add(mesh);
                    }
                }
            }
        }

        // place the whole pivot in world space
        pivot.position.set(previewCenterX, previewCenterY, 0.5);
    }



    _addTriangleMesh(group, gridCol, gridRow, subRow, subCol, colorIndex, isActive) {
        const geom = this._getTriangleGeometry(subRow, subCol);
        if (!geom) return;

        const colorHex = this.colors[colorIndex] || 0xffffff;
        
        // make active piece glow brightly, locked pieces darker and transparent
        let mat;
        if (isActive) {
            mat = this.activeMaterialsCache[colorIndex];
        } else {
            mat = this.materialsCache[colorIndex];
        }


        const mesh = new THREE.Mesh(geom, mat);

        // Compute cell center in world space:
        // col 0 is leftmost, row 0 is TOP in game, so we invert Y here. 
        const cx = (gridCol - this.boardWidth / 2 + 0.5) * this.cellSize;
        const cy = (this.boardHeight / 2 - gridRow - 0.5) * this.cellSize;
        const cz = isActive ? 0.3 : 0.0; // active piece slightly in front

        mesh.position.set(cx, cy, cz);

        group.add(mesh);
    }
    _createGridLines() {
        // clear old lines
        while (this.gridGroup.children.length > 0) {
            const c = this.gridGroup.children.pop();
            if (c.material) c.material.dispose();
            if (c.geometry) c.geometry.dispose();
        }

        const w = this.boardWidth;
        const h = this.boardHeight;
        const s = this.cellSize;
        const z = 0.5;

        // horizontal lines
        for (let r = 0; r <= h; r++) {
            const y = (h/2 - r) * s;
            const geometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(-(w/2)*s, y, z),
                new THREE.Vector3((w/2)*s,  y, z)
            ]);
            const line = new THREE.Line(geometry, this.gridMaterial);
            this.gridGroup.add(line);
        }

        // vertical lines
        for (let c = 0; c <= w; c++) {
            const x = (c - w/2) * s;
            const geometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(x,  (h/2)*s, z),
                new THREE.Vector3(x, -(h/2)*s, z)
            ]);

            const line = new THREE.Line(geometry, this.gridMaterial);
            this.gridGroup.add(line);
        }
    }

    _createStarfield() {
        const starCount = 2000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);

        for (let i = 0; i < starCount; i++) {
            positions[i * 3 + 0] = (Math.random() - 0.5) * 200;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 200;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
        }

        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.6,
            transparent: true,
            opacity: 0.8
        });

        const stars = new THREE.Points(geometry, material);
        this.scene.add(stars);

        this.stars = stars;
    };

    spawnParticles(worldX, worldY, colorHex, speedMultiplier = 1.0) {
        const count = 32;

        for (let i = 0; i < count; i++) {
           
            const mat = new THREE.MeshBasicMaterial({
                color: colorHex,
                transparent: true,
                opacity: 1.0,
                blending: THREE.AdditiveBlending, 
                depthWrite: false,
                side: THREE.DoubleSide
            });

            const spark = new THREE.Mesh(this.particleGeo, mat);

            spark.position.set(worldX, worldY, 0.4);

            // random rotation so streaks point randomly
            spark.rotation.z = Math.random() * Math.PI * 2;

            // fast velocity
            const angle = Math.random() * Math.PI * 2;
            const speed = 2.5 + Math.random() * 2.0 * speedMultiplier;
            spark.velocity = new THREE.Vector3(
                Math.cos(angle) * speed,
                Math.sin(angle) * speed,
                Math.random() * 1.2
            );

            // lifetime
            spark.life = 0.4 + Math.random() * 0.3;
            spark.startLife = spark.life;

            this.particleGroup.add(spark);
            this.particles.push(spark);
        }
    }

    spawnShockwave(worldX, worldY, colorHex) {
        const mat = new THREE.MeshBasicMaterial({
            color: colorHex,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        const ring = new THREE.Mesh(this.shockwaveGeo, mat);

        ring.position.set(worldX, worldY, 0.3);
        ring.velocity = new THREE.Vector3(0, 0, 0);
        
        ring.life = 0.5;
        ring.startLife = 0.5;

        this.particleGroup.add(ring);
        this.particles.push(ring);
    }

    createRainbowShader() {
        return new THREE.ShaderMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            uniforms: {
                u_time: { value: 0 },
                u_progress: { value: 0 },   
                u_opacity: { value: 1.0 },
                u_width: { value: 0.25 }     
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix *
                                modelViewMatrix *
                                vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                uniform float u_time;
                uniform float u_progress;
                uniform float u_width;
                uniform float u_opacity;

                vec3 hsl2rgb(vec3 hsl) {
                    vec3 rgb = clamp(abs(mod(hsl.x * 6.0 + vec3(0, 4, 2), 6.0) - 3.0) - 1.0,
                                    0.0,
                                    1.0);
                    rgb = rgb * rgb * (3.0 - 2.0 * rgb); // smooth
                    return hsl.z + hsl.y * (rgb - 0.5) * (1.0 - abs(2.0 * hsl.z - 1.0));
                }

                void main() {

                    // distance of pixel from sweep center
                    float dist = abs(vUv.x - u_progress);

                    float mask = smoothstep(u_width, 0.0, dist);

                    // animated internal shimmer
                    float hue = mod(vUv.x * 1.5 + u_time * 0.3, 1.0);

                    vec3 color = hsl2rgb(vec3(hue, 1.0, 0.5));

                    gl_FragColor = vec4(color, (1.0 - mask) * u_opacity);
                }
            `
        });
    }


    triggerLightshow() {
        console.log("Triggering light show!");
        sfx.play("lightshow");

        this.lightshowTime = 0.4;
        this.lightshowElapsed = 0;

        // Full-board quad
        const w = this.boardWidth * this.cellSize * 8.2;
        const h = this.boardHeight * this.cellSize * 2.2;

        const geo = new THREE.PlaneGeometry(w, h);
        const mat = this.createRainbowShader();

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, 0, 6.0);

        this.scene.add(mesh);
        this.rainbowPlane = mesh;
    }

    triggerLineClear(rows) {
        if (rows.length == 1) sfx.play("lineclear", -400);
        if (rows.length == 2) sfx.play("lineclear", -700);
        this.lineClearRows = rows.slice();    
        this.lineClearTime = 0.15; 
        this.lineClearElapsed = 0;
        this.starSpeedTime = 2.0;
        this.starSpeedElapsed = 0;
        this.starRotDir *= -1.0;
        this.lineClearEffects = [];

        for (const r of rows) {
            // compute world Y
            const y = (this.boardHeight / 2 - r - 0.5) * this.cellSize;

            // shiny horizontal wipe beam
            const geo = new THREE.PlaneGeometry(
                this.boardWidth * this.cellSize * 1.5,
                this.cellSize * 0.9
            );

            const mat = new THREE.ShaderMaterial({
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                uniforms: {
                    u_time: { value: 0 },
                    u_progress: { value: 0 }
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix *
                                    modelViewMatrix *
                                    vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    precision highp float;
                    varying vec2 vUv;
                    uniform float u_time;
                    uniform float u_progress;

                    void main() {
                        float mask = smoothstep(u_progress, u_progress + 0.15, vUv.x);
                        float glow = mask * (0.4 + 0.6 * sin(u_time * 40.0));
                        vec3 c = vec3(0.2, 0.9, 1.0) * glow;
                        gl_FragColor = vec4(c, glow);
                    }
                `
            });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(-1.5, y, 1.0);
            this.scene.add(mesh);

            this.lineClearEffects.push(mesh);

            // particles along the cleared line
            for (let c = 0; c < this.boardWidth; c++) {
                const x = (c - this.boardWidth / 2 + 0.5) * this.cellSize;
                this.spawnParticles(x, y, 0x88ccff, 1.2);
            }
        }
    }


    startBoardBounce() {
        this.bounceTime = this.bounceDuration;
    }


    render() {
        // star animation
        let speedFactor = 1.0;
        if (this.starSpeedTime && this.starSpeedTime > 0) {
            this.starSpeedElapsed += 0.016;
            const t = Math.min(1.0, this.starSpeedElapsed / this.starSpeedTime);
            speedFactor = 1.0 + (80.0 - 1.0) * (1.0 - t); // ease out

            if (t >= 1) {
                this.starSpeedTime = 0;
            }
        }
        this.stars.rotation.y += 0.0004 * speedFactor * this.starRotDir;
        this.stars.rotation.x += 0.0001 * speedFactor * this.starRotDir;

        // grid opacity modulation
        const t = performance.now() * 0.001;
        this.gridMaterial.opacity = 0.45 + Math.sin(t * 2.0) * 0.10;

        // grid color modulation
        const hue = (0.55 + 0.05 * Math.sin(t * 0.7)) % 1;
        this.gridMaterial.color.setHSL(hue, 0.8, 0.55);

        // next piece rotation and glow modulation
        if (this.nextPiecePivot) {
            // console.log('rotating next piece');
            if (settings.spinNextPiece) {
                this.nextPiecePivot.rotation.y = t * 3.1;
            } else {
                this.nextPiecePivot.rotation.y = 0; 
            }

            if (this.nextPieceGlow && this.nextPieceGlow.material) {
                this.nextPieceGlow.material.opacity =
                    0.20 + 0.08 * (1 + Math.sin(t * 3.0)) * 0.5;
            }
        }

        // particle animation
        const dt = 0.016;

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= dt;

            if (p.life <= 0) {
                this.particleGroup.remove(p);
                p.geometry.dispose();
                p.material.dispose();
                this.particles.splice(i, 1);
                continue;
            }

            // movement
            p.position.addScaledVector(p.velocity, dt);
            p.velocity.multiplyScalar(0.96);
            // slight upward drift
            p.velocity.z += 0.4 * dt;
            
            // expand shockwave ring
            if (p.geometry.type === "RingGeometry") {
                const s = 1 + (1 - p.life / p.startLife) * 6.0; 
                p.scale.set(s, s, s);
            }
            // flicker
            if (p.geometry.type === "RingGeometry") {
                p.material.opacity = p.life / p.startLife;
            } else {
                p.material.opacity = (p.life / p.startLife) * (0.6 + Math.random() * 0.4);
            }

        }

        // shader rainbow sweep
        if (this.rainbowPlane && this.lightshowTime > 0) {
            const mat = this.rainbowPlane.material;

            this.lightshowElapsed += dt;
            const t = this.lightshowElapsed / this.lightshowTime;
            const eased = Math.min(1.0, t);

            // update uniforms
            mat.uniforms.u_time.value += dt;
            mat.uniforms.u_progress.value = eased;  // sweep left to right

            // fade out at the end
            if (t > 0.8) {
                mat.uniforms.u_opacity.value = (1.0 - t) * 5.0;
            }

            // remove plane at end
            if (t >= 1) {
                this.scene.remove(this.rainbowPlane);
                this.rainbowPlane.geometry.dispose();
                this.rainbowPlane.material.dispose();
                this.rainbowPlane = null;
                this.lightshowTime = 0;
            }
        }

        // 3D line-clear animation
        if (this.lineClearEffects && this.lineClearEffects.length > 0) {
            this.lineClearElapsed += dt;
            const t = this.lineClearElapsed / this.lineClearTime;

            for (const mesh of this.lineClearEffects) {
                const mat = mesh.material;
                mat.uniforms.u_time.value += dt;
                mat.uniforms.u_progress.value = t * 1.2;

                const fade = 1.0 - Math.pow(t, 2.3);
                mesh.material.opacity = fade;
            }

            if (t >= 1) {
                // cleanup
                for (const mesh of this.lineClearEffects) {
                    this.scene.remove(mesh);
                    mesh.geometry.dispose();
                    mesh.material.dispose();
                }
                this.lineClearEffects = [];
            }
        }


        // board bounce
        if (this.bounceTime > 0) {
            this.bounceTime -= dt;
            const t = 1 - (this.bounceTime / this.bounceDuration);

            const motion = Math.sin(t * Math.PI);
            // How far the board moves upward
            const offset = motion * -this.bounceHeight;

            this.boardGroup.position.y = offset;
            this.gridGroup.position.y = offset;
            this.activeGroup.position.y = offset;

        } else {
            // reset
            this.boardGroup.position.y = 0;
            this.gridGroup.position.y = 0;
            this.activeGroup.position.y = 0;
        }

        this.renderer.render(this.scene, this.camera);
    }
}
