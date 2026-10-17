# Notices

## Rat model artwork

The Rat extension displays the following artwork, which is **not** covered by
the extension's MIT license:

- Title: [Low Poly Rat](https://sketchfab.com/3d-models/low-poly-rat-dd63402df69742e39e989801f282e58a)
- Creator: [Tyler Lazzareschi](https://sketchfab.com/tylerlazzareschi)
- License: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)

The creator's description says: "Free to use with credit given, all modeled
and textured by me." The creator has not reviewed or endorsed this extension.

### Changes made to the artwork

The source is the archive `low-poly-rat.zip` (SHA-256
`b340026593dd2d8f86f85853715d7572c6e49c5fe28c31c67398ed1a311a1129`). It holds
one binary FBX (`source/rattri.fbx`, 758 triangles) and three 1024 × 1024 PNG
textures. The build (`scripts/rat-model.mjs`) changes it as follows:

- **Format.** The FBX mesh is converted into vertex arrays (positions,
  normals, texture coordinates) stored as 32-bit floats inside
  `panel/main.js`. The triangles, normals and texture coordinates are
  otherwise unchanged.
- **Transform.** The FBX node's 0.01 scale is baked into the vertices. Its
  scaling pivot and scaling offset cancel each other out, so they do not move
  the mesh. The model keeps the FBX's Y-up axes and is not rotated or
  mirrored. It is then moved so that the centre of its bounding box sits at
  the origin, where the turntable's axis passes. That centre is also the FBX
  node's rotation pivot; the node's own origin lies elsewhere.
- **Material.** The FBX material `lambert1` (plain grey, no textures bound) is
  replaced by a Lambert material that uses `rat_low_lambert1_BaseMap.png` as
  its colour (sRGB) and `rat_low_lambert1_Normal.png` as a tangent-space
  normal map. These two PNGs are embedded byte for byte as in the archive.
- **Normal map convention.** The normal map is used with the green channel
  as supplied (OpenGL, +Y up). An integrability test on its slopes fits that
  convention better than the flipped (DirectX) one.
- **Omitted texture.** `rat_low_lambert1_MaskMap.png` is deliberately not
  used and not shipped. The archive does not document what its channels
  mean. Inside the model's UV islands, red and blue are always 0, green is
  mostly 255 with darker creases, and alpha varies from 22 to 255. That looks
  like a particular engine's packing (occlusion and smoothness), but guessing
  that convention could misrepresent the artwork, so the panel uses Lambert
  shading without it.
- **Presentation.** The extension turns the model slowly about its vertical
  axis. The source contains no animation; the rotation belongs to the
  extension.

## Third-party software

The built `panel/main.js` bundles three.js and the OpenChamber SDK, both under
the MIT license. Their license texts are in `THIRD_PARTY_LICENSES.txt` in the
built extension and the installable ZIP.
