# Updating README screenshots

1. Open the app in a fresh tab and use the built-in fictional demo. Select English and a consistent theme.
2. Take a screenshot of the app, preferably around 1440 × 900 pixels, with browser tabs and desktop panels outside the image. Keep map attribution visible when showing the map.
3. Replace the matching PNG in `docs/images/`:

| File | View |
| --- | --- |
| `timeline-map.png` | Map overview of the demo journey |
| `statistics.png` | Travel statistics and charts |
| `trips.png` | Detected demo trip |

Keeping these filenames updates the existing README images automatically after you commit and push them. Aim for less than 1 MB per image when practical.

To add another image, save it in the same folder and add this to the root README:

```markdown
![A short description of what the screenshot shows](docs/images/your-screenshot.png)
```

Use paths relative to the README, and include the image file in the same commit. You can check the result in GitHub's **Preview** tab when editing the README. See [GitHub's image syntax](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#images).
