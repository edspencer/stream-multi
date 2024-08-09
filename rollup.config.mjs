import typescript from "rollup-plugin-typescript2";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import peerDepsExternal from "rollup-plugin-peer-deps-external";

export default {
  input: "./src/index.ts",
  output: [
    {
      file: "./dist/index.esm.js",
      format: "esm",
      sourcemap: true,
    },
    {
      file: "./dist/index.cjs.js",
      format: "cjs",
      sourcemap: true,
    },
  ],
  plugins: [
    peerDepsExternal(), // Automatically externalize peer dependencies
    resolve({
      extensions: [".mjs", ".js", ".json", ".node", ".ts", ".tsx"],
      preferBuiltins: true,
      moduleDirectories: ["node_modules"],
    }), // Resolve modules from node_modules
    commonjs({
      include: /node_modules/,
      extensions: [".js", ".cjs"],
      ignoreGlobal: false,
      sourceMap: true,
      requireReturnsDefault: "preferred",
    }), // Convert CommonJS modules to ES6
    typescript({
      tsconfig: "./tsconfig.json",
      useTsconfigDeclarationDir: true,
    }),
  ],
  watch: {
    include: "src/**",
  },
};
