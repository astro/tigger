{ lib, pkgs, config, ... }:

with lib;
{
  options.services.tigger = {
    enable = mkOption {
      type = types.bool;
      default = true;
      description = "Enable the bot";
    };
    jid = mkOption {
      type = types.string;
      description = "Jabber-ID";
    };
    password = mkOption {
      type = types.string;
      description = "Jabber password";
    };
    mucs = mkOption {
      type = types.listOf types.string;
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
        serviceConfig = {
          Type = "simple";
          ExecStart = ''
            ${tigger}/bin/tigger \
              ${with cfg; escapeShellArgs ([jid password] ++ mucs)}
          '';
          Restart = "always";
          RestartSec = "10min";

          DynamicUser = true;
          NoNewPrivileges = true;
          LimitNPROC = 16;
          LimitNOFILE = 1024;
          CPUWeight = 5;
          MemoryMax = "512M";
          ProtectSystem = "full";
       };
     };
  };
}
