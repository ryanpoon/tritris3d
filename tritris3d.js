// tritris3d.js
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

// Called every frame from draw(), after game.update()
function renderThreeFromGame(game, paused) {
    if (!threeRenderer || !game) return;
    threeRenderer.updateFromGame(game, paused);
    threeRenderer.render();
}

class ThreeTritrisRenderer {
    constructor() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x202020);

        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);

        // Board centered around (0,0,0) in XY plane, camera in +Z looking toward origin.
        // Put the camera up/right and forward a bit, looking toward center.
        this.camera.position.set(0, 14, 32);   // centered left/right, above the board, forward
        this.camera.lookAt(0, 0, 0);           // look at middle of board
        this.camera.up.set(0, 1, 0);     

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false
        });
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        // Put the WebGL canvas behind UI / DOM, but above page background.
        this.renderer.domElement.style.position = 'fixed';
        this.renderer.domElement.style.left = '0';
        this.renderer.domElement.style.top = '0';
        this.renderer.domElement.style.zIndex = '0';
        // Allow p5 canvas & DOM to receive input normally
        this.renderer.domElement.style.pointerEvents = 'none';

        document.body.appendChild(this.renderer.domElement);

        //  LIGHTS 
        const ambient = new THREE.AmbientLight(0xffffff, 0.45);
        this.scene.add(ambient);

        const keyLight = new THREE.PointLight(0xffffff, 1.2, 200);
        keyLight.position.set(30, 40, 60);
        this.scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0xffffff, 0.6);
        rimLight.position.set(-20, 40, -10);
        this.scene.add(rimLight);


        //  GROUPS FOR BOARD + ACTIVE PIECE + NEXT PIECE
        this.boardGroup = new THREE.Group();
        this.boardGroup.name = 'BoardGroup3D';
        this.scene.add(this.boardGroup);

        this.activeGroup = new THREE.Group();
        this.activeGroup.name = 'ActivePiece3D';
        this.scene.add(this.activeGroup);

        this.nextPieceGroup = new THREE.Group();
        this.nextPieceGroup.name = 'NextPiece3D';
        this.scene.add(this.nextPieceGroup);


        // Board dimensions (read from Game, but set defaults here)
        this.boardWidth = 8;
        this.boardHeight = 16;
        this.cellSize = 1.0;

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

        // Geometry cache: key 'row_col' -> BufferGeometry
        this.triGeometryCache = {};
        this.localTriangles = this._buildLocalTriangleDefs();

        this._addBoardFrame();

        window.addEventListener('resize', () => this._onResize());
        this._onResize();

        
    }

    _onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

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
        // Plane in XY, facing +Z (default orientation)
        frame.position.set(0, 0, -0.1); // slightly behind triangles
        this.scene.add(frame);
    }

    // Define triangle corners local to the center of a cell.
    // Cell center is (0,0); each cell is cellSize x cellSize.
    // We mirror the four sub-triangles used in Triangle.show. 
    _buildLocalTriangleDefs() {
        const s = this.cellSize;
        const h = s / 2;

        const TL = { x: -h, y:  h };
        const TR = { x:  h,  y:  h };
        const BL = { x: -h, y: -h };
        const BR = { x:  h,  y: -h };

        // IMPORTANT: each triangle is consistently wound counter-clockwise  
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
        const depth = 0.25;           // thickness of pieces
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

    updateFromGame(game, paused) {
        this.boardWidth = game.w;
        this.boardHeight = game.h;

        // Clear old meshes
        this._clearGroup(this.boardGroup);
        this._clearGroup(this.activeGroup);
        this._clearGroup(this.nextPieceGroup);

        //  LOCKED GRID (board) 
        const grid = game.grid.grid; // [row][col] => GridCell 
        for (let row = 0; row < game.h; row++) {
            for (let col = 0; col < game.w; col++) {
                const cell = grid[row][col];
                if (!cell || !cell.tris) continue;

                for (let subRow = 0; subRow < 2; subRow++) {
                    for (let subCol = 0; subCol < 2; subCol++) {
                        const tri = cell.tris[subRow][subCol];
                        if (!tri) continue;

                        const colorIndex = tri.clr; // Triangle.clr 
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

    }

    _updateNextPiece(game) {
        const np = game.nextPiece;
        if (!np) return;

        const rows = np.grid.length;
        const cols = np.grid[0].length;

        // Where to place the center of the next-piece preview in world coordinates:
        // Board x range is roughly [-4, +4]; put preview to the right of that.
        const previewCenterX = (this.boardWidth / 2 + 2.5) * this.cellSize; // ~6.5
        const previewCenterY = (this.boardHeight / 2 - 3) * this.cellSize;  // a bit below the top

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const cell = np.grid[row][col];
                if (!cell || !cell.tris) continue;

                for (let subRow = 0; subRow < 2; subRow++) {
                    for (let subCol = 0; subCol < 2; subCol++) {
                        const tri = cell.tris[subRow][subCol];
                        if (!tri) continue;

                        const geom = this._getTriangleGeometry(subRow, subCol);
                        if (!geom) continue;

                        const colorHex = this.colors[tri.clr] || 0xffffff;
                        const mat = new THREE.MeshPhongMaterial({
                            color: colorHex,
                            shininess: 80,
                            side: THREE.DoubleSide
                        });

                        const mesh = new THREE.Mesh(geom, mat);

                        // Center the piece within a 3x3 mini-grid, similar to Piece.showAt. 
                        const dim = 3;
                        const scale = this.cellSize * 0.8; // slightly smaller so it fits nicely

                        const localX = (col - cols / 2 + 0.5) * scale * (dim / 3);
                        const localY = -(row - rows / 2 + 0.5) * scale * (dim / 3);

                        mesh.position.set(
                            previewCenterX + localX,
                            previewCenterY + localY,
                            0.3  // a bit in front
                        );

                        this.nextPieceGroup.add(mesh);
                    }
                }
            }
        }
    }


    _addTriangleMesh(group, gridCol, gridRow, subRow, subCol, colorIndex, isActive) {
        const geom = this._getTriangleGeometry(subRow, subCol);
        if (!geom) return;

        const colorHex = this.colors[colorIndex] || 0xffffff;
        const mat = new THREE.MeshPhongMaterial({
            color: colorHex,
            shininess: isActive ? 70 : 20,
            side: THREE.DoubleSide // visible from both sides
        });

        const mesh = new THREE.Mesh(geom, mat);

        // Compute cell center in world space:
        // col 0 is leftmost, row 0 is TOP in game, so we invert Y here. 
        const cx = (gridCol - this.boardWidth / 2 + 0.5) * this.cellSize;
        const cy = (this.boardHeight / 2 - gridRow - 0.5) * this.cellSize;
        const cz = isActive ? 0.3 : 0.0; // active piece slightly in front

        mesh.position.set(cx, cy, cz);

        group.add(mesh);
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }
}
