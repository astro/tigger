/* Virus code */

import * as fetch from 'node-fetch';
import * as leven from 'leven';

const COVID_URL = "https://www.coronavirus.sachsen.de/corona-statistics/rest/incidence.jsp";

export async function getCovid(wantedLocation) {
    const location = (wantedLocation || "Dresden").toLocaleLowerCase();

    return fetch(COVID_URL)
        .then(res => res.json())
        .then(stats => {
            return stats.map(x => {
                const nameParts = x.name.toLocaleLowerCase()
                      .split(/\s+/);
                x.distance = Math.min.apply(null,
                    nameParts.map(namePart => leven(location, namePart))
                );
                return x;
            }).sort((a, b) => a.distance - b.distance)[0]
        })
}
