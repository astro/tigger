{ lib, pkgs, config, ... }:

with lib;
{
  options.services.tigger = {
    enable = mkOption {
      type = types.bool;
      default = true;
      description = "Enable the bot";
    };
    user = mkOption {
      type = types.str;
    };
    group = mkOption {
      type = types.str;
    };
    jid = mkOption {
      type = types.str;
      description = "Jabber-ID";
    };
    password = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = "Jabber password";
    };
    passwordFile = mkOption {
      type = types.str;
      default = null;
      description = "Jabber password in a file";
    };
    mucs = mkOption {
      type = types.listOf types.str;
      description = "MUC Jabber-IDs";
    };
  };

  config =
    let
      cfg = config.services.tigger;
      tigger = pkgs.callPackage ./default.nix {};
    in mkIf cfg.enable {
      systemd.services.tigger = {
        description = "MUC bot";
        wantedBy = [ "multi-user.target" ];
        after    = [ "network.target" ];
        script = ''
          ${lib.getExe tigger} ${with cfg; concatStringsSep " " ([jid]
            ++ lib.optional (password != null) password
            ++ lib.optional (passwordFile != null) "$(cat ${passwordFile})"
            ++ mucs)}
        '';
        serviceConfig = {
          Type = "simple";
          Restart = "always";
          RestartSec = "10min";

          User = cfg.user;
          Group = cfg.group;
          NoNewPrivileges = true;
          LimitNPROC = 32;
          LimitNOFILE = 1024;
          CPUWeight = 5;
          MemoryMax = "512M";
          ProtectSystem = "full";
          ProtectHome = "tmpfs";
       };
     };
  };
}
