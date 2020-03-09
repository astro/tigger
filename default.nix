{pkgs ? import <nixpkgs> {}}:
with pkgs;

let
  nodejs = nodejs-10_x;
  nodeEnv = import ./node-env.nix {
    inherit (pkgs) stdenv python2 utillinux runCommand writeTextFile;
    inherit nodejs;
    libtool = if pkgs.stdenv.isDarwin then pkgs.darwin.cctools else null;
  };
  package = (import ./node-packages.nix {
    inherit (pkgs) fetchurl fetchgit;
    inherit nodeEnv;
  }).package.override { bypassCache = true; };
in

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

    export PATH=${pkgs.nix}/bin
    cd ${package}/lib/node_modules/tigger
    ${nodejs}/bin/node server.js \$@
    EOF
    chmod a+x $out/bin/tigger
  '';
}
