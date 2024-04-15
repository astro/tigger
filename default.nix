# This file has been generated by node2nix 1.11.1. Do not edit!

{ pkgs ? import <nixpkgs> { inherit system; }
, system ? builtins.currentSystem
, nodejs ? pkgs."nodejs-16_x"
}:

let
  nodeEnv = import ./node-env.nix {
    inherit (pkgs) stdenv lib python2 runCommand writeTextFile writeShellScript;
    inherit pkgs nodejs;
    libtool = if pkgs.stdenv.isDarwin then pkgs.darwin.cctools else null;
  };

  inherit (import ./node-packages.nix {
    inherit (pkgs) fetchurl nix-gitignore stdenv lib fetchgit;
    inherit nodeEnv;
  }) package;

in
with pkgs;

stdenv.mkDerivation {
  name = "tigger";
  buildInputs = [ package ];
  src = ./.;
  dontBuild = true;
  installPhase = ''
    mkdir -p $out/bin
    cat > $out/bin/tigger << EOF
    #!/usr/bin/env bash
    set -e

    export PATH=${lib.makeBinPath [nix gzip gnutar]}
    cd ${package}/lib/node_modules/tigger
    ${nodejs}/bin/node server.js \$@
    EOF
    chmod a+x $out/bin/tigger
  '';

  meta.mainProgram = "tigger";
}
