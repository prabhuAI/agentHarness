# CompileKit design intelligence

The scored runtime does not load an external skill, execute Python, download fonts, or ask the model to generate CSS. It compiles four bounded design-intent enums into the reviewed tokens in `catalog.ts`.

The catalog and its accessibility priorities were curated from [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), used under its MIT license. CompileKit retains only a small, deterministic subset:

- five genome-specific layout archetypes;
- six accessible color palettes;
- local system-font stacks;
- three density and motion levels;
- visible focus, touch-target, reduced-motion, form-feedback, and responsive-layout rules.

This boundary is deliberate: the model describes intent, while the compiler owns implementation. It prevents arbitrary generated CSS and keeps normal generation to one model call.
