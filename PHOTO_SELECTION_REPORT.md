# Photo Selection Report

## Old iPhone Photo Review

### Scope and method

- Source reviewed read-only: `C:\Users\cheem\Desktop\iphone 15`
- 6,862 still-image files were discovered across 66 dated export folders (`200605_a` through `202604_a`). JPG/JPEG, HEIC/HEIF, PNG, WebP, GIF, and DNG were included where locally readable.
- Dated subfolders were considered recursively. The existing `review_output` folder was inspected as prior review material but excluded from the source-file count and from selection because it contains derivatives rather than originals.
- Files were screened from temporary contact sheets, then finalists were opened at higher resolution. No facial recognition or identity inference was performed.
- The review was deliberately conservative: group photographs, recognizable companions, screenshots, documents, receipts, private screens, weak duplicates, and unclear personal contexts were rejected.

### Shortlist

| Source file | Folder | Dimensions | Category | Assessment and privacy notes | Recommended use | Suggested crop |
| --- | --- | ---: | --- | --- | --- | --- |
| `VAEJ7786.JPEG` | `202404_a` | 3024×4032 | Solo/outdoors | Strong low-angle composition and dramatic sky; lone subject faces away and no bystanders are identifiable. | **Selected: About portrait modal** | Portrait crop retained; trim only through responsive `object-fit`. |
| `IMG_1866.JPG` | `202505_a` | 4032×3024 | Outdoors/photography | Strong lake sunset, no people or private details. Original contains GPS, removed from public copy. | **Selected: About portrait modal** | Portrait-oriented center crop emphasizing sun and reflection. |
| `IMG_E9123.JPG` | `202412_a` | 1290×1731 | Music | Excellent warm light and clear guitar-playing gesture, but the source has social overlay text and an identifiable face. | **Selected after privacy crop: Music card and About modal** | Tight landscape crop to hands/instrument, excluding face and overlays. |
| `IMG_1722.JPG` | `202505_a` | 4032×3024 | Outdoors/photography | Moody purple lake horizon with no people; safe but less crisp and less distinctive than `IMG_1866.JPG`. GPS present in original. | Alternate | Wide horizon crop. |
| `IMG_1551.JPG` | `202504_a` | 5712×4284 | Outdoors | Clean blue lake scene; safe, but visually quieter than the selected sunset. GPS present in original. | Alternate | Wide landscape crop; remove foreground edge. |
| `IMG_1604.JPG` | `202504_a` | 5712×4284 | Photography | Striking orange storm light and reflections; public parking lot and tiny incidental figures, but less personal and compositionally busy. GPS present in original. | Alternate | Crop signage and excess parked cars where practical. |
| `IMG_9662.JPG` | `202405_a` | 3024×4032 | Outdoors/photography | Aurora-like night sky; safe and atmospheric, though noisy at full size. | Alternate | Keep vertical sky emphasis. |
| `IMG_2888.JPG` | `202401_a` | 2048×1365 | Place/architecture | Attractive waterfront and bridge scene; no meaningful people, but overlaps the existing photography gallery. | Alternate | Wide crop retaining bridge and shoreline. |
| `IMG_9806.JPG` | `202503_a` | 3024×4032 | Cars | Strong blue-car portrait with no people, but the plate is clearly readable. | Reject for public use | Would require plate removal; not needed because current car imagery is stronger. |
| `IMG_E5549.JPG` | `202405_a` | 1179×1570 | Cars | White-car image with pleasing sky; appears to be a saved/social image rather than an original camera frame. | Reject | None. |
| `IMG_6873.JPG` | `202305_a` | 1170×1169 | Cars/maintenance | Useful underbody/mechanical context; close framing and moderate quality. | Alternate for technology modal | Tight crop around mechanical detail. |
| `IMG_6874.JPG` | `202305_a` | 1170×1161 | Cars/maintenance | Clear engine-bay documentation, but visually utilitarian and likely a saved image. | Alternate | Tight engine-bay crop. |
| `IMG_8514.JPG` | `202411_a` | 5712×4284 | Technology | Strong custom-PC lighting and hardware detail; safe after metadata removal. Existing PC-build modal image tells the story better. GPS present in original. | Alternate for technology modal | Landscape crop around illuminated components. |
| `IMG_E9063.JPG` | `202412_a` | 1290×977 | Cars/technology | Clear engine-bay view; no people, but lower resolution and less polished than current modal imagery. | Alternate | Minimal crop around engine bay. |
| `IMG_8039.JPG` | `202410_a` | 4032×3024 | Gaming | Tasteful steering-wheel gaming setup; private room context is visible and the photograph is compositionally ordinary. | Reject | None. |
| `IMG_8110.JPG` | `202410_a` | 5712×4284 | Food | Colorful bowl with good texture; restaurant tabletop context only. GPS present in original. | Food alternate | Square crop centered on bowl. |
| `IMG_9671.JPG` | `202501_a` | 4032×3024 | Food | Casual takeout meal; safe but not polished enough for the final gallery. | Reject / alternate | Tight crop excluding table clutter. |
| `IMG_1884.JPG` | `202506_a` | 5712×4284 | Food | Simple burger photograph with clean plate; safe but visually generic. GPS present in original. | Reject / alternate | Square food crop. |
| `IMG_1970.JPG` | `202506_a` | 5712×4284 | Outdoors | Calm lakeshore scene; safe and usable but duplicates the stronger selected lake imagery. GPS present in original. | Alternate | Wide water-and-shore crop. |
| `IMG_9879.JPG` | `202404_a` | source unavailable in current export | Event/photography | Eclipse frame looked promising in prior contact material, but no matching original was found in the allowed source folder. | Reject | None. |

### Final selections and implementation

- `IMGP0700.JPG` → `src/assets/about/quang/quang-beach-sunset-web.jpg`
- `IMGP0719.JPG` → `src/assets/about/quang/quang-art-space-web.jpg`
- `_DSC0030.JPG` → `src/assets/about/quang/quang-waterfront-web.jpg`
- All three photos opened from the top portrait's “View photos” action now live in `src/assets/about/quang`.
- The previous Music card asset is no longer referenced because its folder was removed during asset reorganization.
- The existing main portrait remains unchanged.
- The portrait modal contains exactly three strong images, so no artificial “View all” state was added.
- Music gained a card image. Photography, Hiking, Cars & technology, Gaming, and Family & friends retain their existing card choices. No additional food card was added.
- No phone image was added to the Cars & technology modal because the existing PC-build photograph remains clearer and more polished.

### Rejection and privacy notes

- All photos with friends, family groups, classmates, children, recognizable companions, or uncertain identities were excluded, regardless of image quality.
- The untracked `src/assets/about/family/vietnam-2023.jpg` asset was preserved and was not used or modified.
- Screenshots, memes, messages, schoolwork, receipts, menus with unnecessary details, IDs, maps, account screens, and low-value snapshots were excluded.
- Car photos with readable plates were rejected instead of retouched because suitable existing portfolio assets already exist.
- Bursts and near-duplicates were reduced to their strongest representative frame during shortlisting.
- Public copies were re-encoded as progressive JPEGs with a maximum dimension of 1400 px. EXIF was omitted on export; GPS, device, software, capture-date, and serial metadata are therefore not present in the public files.

### Additional cars and technology review

- `202507_a/IMG_2395.JPG` → `cars-tech/car-show-porsche-web.jpg`: selected after a tight crop removed unrelated plates and kept car-show attendees tiny and incidental.
- `202507_a/IMG_2397.JPG` → `cars-tech/car-show-subaru-engine-web.jpg`: selected as a mechanical-detail frame; cropped to the car and engine bay so no face is visible.
- `202604_a/IMG_6450.JPG` → `cars-tech/custom-pc-green-web.jpg`: selected as the strongest finished-PC photograph, with no private screen or serial information visible.
- `202604_a/IMG_6515.JPG` → `cars-tech/graphics-card-rtx-3080-ti-web.jpg`: selected as a clean physical-hardware detail.
- Other July 2025 car-show frames were rejected because recognizable attendees or readable license plates were too prominent. Rear-panel PC photos were rejected because equipment labels and serial-like identifiers were visible.
- These four optimized, metadata-free copies were added to the Cars & technology modal alongside the existing PC-build image.
