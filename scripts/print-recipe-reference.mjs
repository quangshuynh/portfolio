// Prints the QuangEdit Recipe authoring reference (the same text as the editor's Recipe
// instructions), generated from the adjustment registry and the Filter Library.
// Usage: npm run recipe:reference > recipe-reference.md
import { recipeReference } from '../src/editor/model/recipeReference.mjs';

process.stdout.write(recipeReference());
