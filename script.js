import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration ---
const COST_PER_GRAM = 10; // Rs per gram
const TARGET_EMAIL = "your-print-service@example.com"; // CHANGE THIS to the recipient email

// --- DOM Elements ---
const fileInput = document.getElementById('stlFile');
const fileInfo = document.getElementById('fileInfo');
const viewerContainer = document.getElementById('viewer');
const viewerMessage = document.getElementById('viewerMessage');
const colorInput = document.getElementById('colorInput');
const materialInput = document.getElementById('materialInput');
const costResultDiv = document.getElementById('costResult');
const emailLink = document.getElementById('emailLink');
const emailStatus = document.getElementById('emailStatus');

// --- State Variables ---
let scene, camera, renderer, controls, currentMesh;
let modelVolumeCm3 = 0; // Placeholder for volume in cubic centimeters
let loadedFileName = '';

// --- Initialization ---
function initThreeJS() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeeeeee);

    // Camera
    const fov = 75;
    const aspect = viewerContainer.clientWidth / viewerContainer.clientHeight;
    const near = 0.1;
    const far = 1000;
    camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    camera.position.set(50, 50, 50); // Initial position

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(viewerContainer.clientWidth, viewerContainer.clientHeight);
    viewerContainer.innerHTML = ''; // Clear message
    viewerContainer.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 50, 50);
    scene.add(directionalLight);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; // an animation loop is required when either damping or auto-rotation are enabled
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false;
    controls.maxPolarAngle = Math.PI / 2; // prevent flipping under model

    // Animation Loop
    animate();

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = viewerContainer.clientWidth / viewerContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewerContainer.clientWidth, viewerContainer.clientHeight);
}

function animate() {
    if (!renderer) return; // Stop if not initialized
    requestAnimationFrame(animate);
    if (controls) controls.update(); // only required if controls.enableDamping = true, or if controls.autoRotate = true
    renderer.render(scene, camera);
}

// --- STL Loading ---
const loader = new STLLoader();

fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    loadedFileName = file.name;
    fileInfo.textContent = `File: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
    viewerMessage.textContent = 'Loading model...';
    resetState(); // Clear previous model and cost

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const geometry = loader.parse(e.target.result);

            if (!scene) { // Initialize Three.js only when first file is loaded
                initThreeJS();
            } else {
                 viewerMessage.textContent = ''; // Clear loading message if already init
            }

            geometry.computeBoundingBox(); // Needed for centering and volume estimate
            geometry.center(); // Center the model

            // --- Placeholder Volume Calculation ---
            // This is a ROUGH ESTIMATE using the bounding box, NOT accurate mesh volume.
            const boundingBox = geometry.boundingBox;
            const size = new THREE.Vector3();
            boundingBox.getSize(size);
            // Assuming units are mm, convert to cm³ (1 cm³ = 1000 mm³)
            modelVolumeCm3 = (size.x * size.y * size.z) / 1000;
            // For a more realistic (but still rough) estimate, assume ~30-50% fill of the bounding box
            modelVolumeCm3 *= 0.4; // Adjust this factor based on typical model density

            // Material and Mesh
            const material = new THREE.MeshStandardMaterial({
                color: 0xcccccc, // Default grey
                metalness: 0.1,
                roughness: 0.75,
            });
            currentMesh = new THREE.Mesh(geometry, material);
            scene.add(currentMesh);

            // Adjust camera to fit the model
            fitCameraToObject(camera, currentMesh, 1.5, controls);

            // Enable inputs and calculation
            enableInputsAndCalc();
            updateCostAndEmail(); // Initial calculation

        } catch (error) {
            console.error('Error loading STL:', error);
            viewerMessage.textContent = 'Error loading STL file. Please check the file format.';
            fileInfo.textContent = `File: ${loadedFileName} - Load Error`;
            resetState();
        }
    };

    reader.onerror = () => {
         console.error('Error reading file');
         viewerMessage.textContent = 'Error reading file.';
         fileInfo.textContent = `File: ${loadedFileName} - Read Error`;
         resetState();
    };

    reader.readAsArrayBuffer(file); // Read as ArrayBuffer for STLLoader
});

// --- Camera Helper ---
function fitCameraToObject(camera, object, offset = 1.2, controls) {
    const boundingBox = new THREE.Box3().setFromObject(object);
    const center = boundingBox.getCenter(new THREE.Vector3());
    const size = boundingBox.getSize(new THREE.Vector3());

    // get the max side of the bounding box (fits to width OR height depending on aspect ratio)
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));

    cameraZ *= offset; // zoom out a little so object isn't edge to edge

    // Adjust camera position
    // Set camera to look at center of object
    camera.position.set(center.x, center.y, center.z + cameraZ); // Position along Z axis relative to center
    camera.lookAt(center); // Ensure camera looks at the center


    // set the far plane of the camera so that it easily encompasses the whole object
    const minZ = boundingBox.min.z;
    const cameraToFarEdge = (minZ < 0) ? -minZ + cameraZ : cameraZ - minZ;
    camera.far = cameraToFarEdge * 3; // Make far plane 3x the distance to the object
    camera.updateProjectionMatrix();

    // Update controls target if controls exist
    if (controls) {
        controls.target.copy(center);
        controls.update();
    }
}

// --- Cost Calculation & Email Link ---
function updateCostAndEmail() {
    if (!currentMesh || modelVolumeCm3 <= 0) {
        costResultDiv.innerHTML = `<p>Please upload a file and select material.</p><p>Rate: ₹${COST_PER_GRAM} per gram</p><p class="warning"><strong>Note:</strong> Volume calculation is an approximation.</p>`;
        emailLink.classList.add('disabled');
        emailLink.removeAttribute('href');
        emailStatus.textContent = '';
        return;
    }

    const selectedOption = materialInput.selectedOptions[0];
    const density = parseFloat(selectedOption.dataset.density); // g/cm³
    const materialName = selectedOption.value;
    const color = colorInput.value.trim() || 'Not specified';

    if (!materialName || density <= 0) {
        costResultDiv.innerHTML = `<p>Please select a valid material.</p><p>Rate: ₹${COST_PER_GRAM} per gram</p><p class="warning"><strong>Note:</strong> Volume calculation is an approximation.</p>`;
        emailLink.classList.add('disabled');
        emailLink.removeAttribute('href');
        emailStatus.textContent = '';
        return;
    }

    // Calculate mass and cost
    const massGrams = modelVolumeCm3 * density;
    const estimatedCost = massGrams * COST_PER_GRAM;

    costResultDiv.innerHTML = `
        <p>Est. Volume: ${modelVolumeCm3.toFixed(2)} cm³ (Approximate)</p>
        <p>Material: ${materialName} (${density} g/cm³)</p>
        <p>Est. Mass: ${massGrams.toFixed(2)} g</p>
        <p><strong>Estimated Cost: ₹${estimatedCost.toFixed(2)}</strong></p>
         <p class="warning"><strong>Note:</strong> Volume calculation is an approximation.</p>
    `;

    // Prepare Mailto Link
    const subject = `3D Print Quote Request - ${loadedFileName}`;
    const body = `Hello,\n\nPlease find the details for a 3D printing quote request below:\n
File Name: ${loadedFileName}
Color: ${color}
Material: ${materialName}
Estimated Volume: ${modelVolumeCm3.toFixed(2)} cm³ (approx.)
Estimated Mass: ${massGrams.toFixed(2)} g (approx.)
Estimated Cost: ₹${estimatedCost.toFixed(2)} (approx.)\n
(Remember to attach the STL file: ${loadedFileName})\n
Thank you.`;

    const mailtoHref = `mailto:${TARGET_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    emailLink.href = mailtoHref;
    emailLink.classList.remove('disabled');
    emailStatus.textContent = 'Ready to generate email draft.';
}

// --- Helper Functions ---
function resetState() {
    // Clear 3D scene
    if (scene && currentMesh) {
        scene.remove(currentMesh);
        currentMesh.geometry.dispose();
        currentMesh.material.dispose();
        currentMesh = null;
        // Don't destroy renderer, camera, controls unless necessary
        // We can reuse them. Only clear the model.
        renderer.render(scene, camera); // Render the empty scene
    }
     if(viewerMessage && !renderer) viewerMessage.textContent = 'Please upload an STL file to view.'; // Show msg if viewer not init
     if(viewerMessage && renderer) viewerMessage.textContent = ''; // Clear message if viewer exists


    // Reset inputs/results
    // fileInput.value = ''; // Don't clear file input, user might re-select
    colorInput.value = '';
    materialInput.value = '';
    modelVolumeCm3 = 0;
    loadedFileName = '';
    // fileInfo.textContent = ''; // Keep file info until new file loaded

    costResultDiv.innerHTML = `<p>Please upload a file and select material.</p><p>Rate: ₹${COST_PER_GRAM} per gram</p><p class="warning"><strong>Note:</strong> Volume calculation is an approximation.</p>`;
    emailLink.classList.add('disabled');
    emailLink.removeAttribute('href');
    emailStatus.textContent = '';
    colorInput.disabled = true;
    materialInput.disabled = true;
}

function enableInputsAndCalc() {
    colorInput.disabled = false;
    materialInput.disabled = false;
}

// --- Event Listeners for Inputs ---
colorInput.addEventListener('input', updateCostAndEmail);
materialInput.addEventListener('change', updateCostAndEmail);

// --- Initial State ---
resetState(); // Start with disabled inputs/button
