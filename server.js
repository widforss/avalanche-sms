const cheerio = require('cheerio');
const request = require('request');
const FuzzySearch = require('fuzzy-search');
const express = require('express');
const bodyParser = require("body-parser");

const areas = [
    {
        name: 'Abisko/Riksgränsfjällen',
        url: 'abisko-riksgransfjallen',
    },
    {
        name: 'Kebnekaisefjällen',
        url: 'kebnekaisefjallen',
    },
    {
        name: 'Västra Vindelfjällen',
        url: 'vastra_vindelfjallen',
    },
    {
        name: 'Södra Lapplandsfjällen',
        url: 'sodra-lapplandsfjallen',
    },
    {
        name: 'Södra Jämtlandsfjällen',
        url: 'sodra_jamtlandsfjallen',
    },
    {
        name: 'Västra Härjedalsfjällen',
        url: 'vastra_harjedalsfjallen',
    },
];

const searcher = new FuzzySearch(areas, ['name'], {
    caseSensitive: false,
    sort: true,
});

var app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.post('/', function (req, res) {
    run(req.body.message, (report) => res.send(report));
});
app.listen(8000, () => {
    let string = `Express: \tWeb server started.`;
    console.log(string);
})

function run(string, callback) {
    let inputArray = string.split(' ');
    if (inputArray.length == 0 || inputArray > 2) {
        callback('');
        return;
    }

    let [areaString, dateString] = inputArray;

    let area = searcher.search(areaString);
    if (area.length == 0 || area.length > 2) {
        callback('');
        return;
    }

    let date = new Date(dateString);
    if (!isNaN(date)) {
        date = [
            date.getFullYear(),
            date.getMonth() + 1,
            date.getDate(),
        ].join('-');
    } else {
        date = null
    }

    let url = 'http://www.lavinprognoser.se/oversikt-alla-omraden/' +
        area[0].url + '/prognos/'
    if (date) {
        url += '?forecastdate=' + date;
    }

    scrape(url, callback);
}

function scrape(url, callback) {
    request(url, (err, response, body) => {
        if (err) {
            callback('')
            return;
        }

        const $ = cheerio.load(body, {
            xml: {
                normalizeWhitespace: true,
            }
        });
        let containers = $('.App-container');
        let head = containers.eq(0);
        let problems = $('.Topic-container').get();
        let foot = containers.eq(1);

        let report = [
            parseHead($, head),
            parseProblems($, problems),
            //parseFoot($, foot),
        ]
            .filter(Boolean)
            .join('\n\n')
            .replace(/\n +/g, '\n')
            .replace(/ +\n/g, '\n');

        callback(report);
    });
}

function parseHead($, head) {
    let dates = $('.Forecast-date', head);
    let publishDate = dates.eq(0).text();
    let expireDate = dates.eq(1).text();

    let title = $('.Forecast-title', head).eq(0).text();
    let dangerScale = $('.Symbol-label', head).eq(0).text();

    let dangers = $('.Forecast-risk');
    let danger = dangers.eq(0).text();
    let dangerTrend = dangers.eq(1).text();

    let titles = $('.Summary-title', head);
    let summaryTitle = titles.eq(0).text();
    let trendTitle = titles.eq(1).text();

    let titleText = $('.Forecast-text', head).eq(0).text();
    let summary = $('.Summary-content', head).eq(0).text();

    if (danger == 'Ej bedömd lavinfara') {
        dangerScale = null;
    }

    return [
        title ? title + '\n' : null,
        publishDate ? publishDate : null,
        expireDate ? expireDate + '\n' : null,
        (dangerScale ? parseInt(dangerScale, 10) + '. ' : '') +
        (danger ? danger + '\n' : ''),
        //titleText ? titleText + '\n' : null,
        //summaryTitle ? summaryTitle + ':' : null,
        //summary ? summary + '\n' : null,
        trendTitle ? trendTitle + ':' : null,
        dangerTrend ? dangerTrend : null,
    ]
        .filter(Boolean)
        .join('\n');
}

function parseProblems($, problems) {
    return problems.map((problem) => parseProblem($, problem))
        .filter(Boolean)
        .join('\n\n');
}

function parseProblem($, problem) {
    let title = $('.Forecast-title', problem).eq(0).text();
    let summary = $('.Summary-content', problem).eq(0).text();

    let heights = $('.AltitudeMeter g g polygon', problem).get()
        .map((elem) => parseHeight(elem.attribs.points))
        .filter(Boolean)
        .join(', ');

    let dirs = $('.DirectionMeter g g polygon', problem).get()
        .map((elem) => parseDirs(elem.attribs.points))
        .filter(Boolean);
    dirs.reverse();
    dirs = dirs.join(', ')

    let meters = $('.SizeMeter-needle', problem);
    let probAngle = meters.eq(0).attr('transform');
    let probability = parseProb(probAngle);
    let sizeAngle = meters.eq(1).attr('transform');
    let size = parseSize(sizeAngle);

    return [
        title ? title : null,
        heights ?
            'Höjder: ' + heights.charAt(0).toUpperCase() + heights.slice(1) :
            null,
        dirs ? 'Väderstreck: ' + dirs : null,
        probability ? 'Sannolikhet: ' + probability : null,
        size ? 'Storlek: ' + size : null,
        //summary ? summary : null,
    ].join('\n');
}

function parseFoot($, foot) {
    let obsTitle = $('.Summary-title', foot).eq(0).text();
    let obs = $('.Summary-content', foot).eq(0).text();
    let weatherTitle = $('.Summary-title', foot).eq(1).text();
    let weather = $('.Summary-content', foot).eq(1).text();

    return [
        obsTitle ? obsTitle + ':' : null,
        obs ? obs + '\n' : null,
        weatherTitle ? weatherTitle + ':' : null,
        weather ? weather : null,
    ].join('\n');
}

function parseProb(prob) {
    let osannolikt = /rotate\(5 143 104\)/g;
    let mojligt = /rotate\(40 143 104\)/g;
    let troligt = /rotate\(85 143 104\)/g;
    let mycketTroligt = /rotate\(130 143 104\)/g;
    let utanTvivel = /rotate\(165 143 104\)/g;
    if (prob.match(osannolikt)) return 'Osannolikt';
    if (prob.match(mojligt)) return 'Möjligt';
    if (prob.match(troligt)) return 'Troligt';
    if (prob.match(mycketTroligt)) return 'Mycket troligt';
    if (prob.match(utanTvivel)) return 'Utan tvivel';
}

function parseSize(prob) {
    let small = /rotate\(5 143 104\)/g;
    let large = /rotate\(85 143 104\)/g;
    let veryLarge = /rotate\(165 143 104\)/g;
    if (prob.match(small)) return 'Små';
    if (prob.match(large)) return 'Stora';
    if (prob.match(veryLarge)) return 'Mycket stora';
}

function parseDirs(direction) {
    let north = /108\.6,110\.9 82\.5,48\.4 109\.3,30\.8 134\.3,48\.7/g;
    let northeast = /111\.4,111\.7 137\.1,49\.8 167\.7,54\.8 172\.2,86\.5/g;
    let east = /112\.5,114\.6 173\.7,89\.1 191\.6,115\.3 174\.7,141/g;
    let southeast = /111\.3,117\.3 174\.1,144 168\.2,173\.6 137\.3,179\.8/g;
    let south = /108\.6,118\.7 134\.7,181\.3 108\.5,198\.8 82\.7,181\.1/g
    let southwest = /105\.9,117\.3 80,179\.7 48\.6,174\.8 43,143\.5/g;
    let west = /104\.7,114\.5 41\.7,140\.7 24\.5,114\.9 42\.8,88\.2/g;
    let northwest = /49\.9,55 43\.5,85\.2 105\.6,111\.6 79\.6,49\.2/g;
    if (direction.match(north)) return 'N';
    if (direction.match(northeast)) return 'NO';
    if (direction.match(east)) return 'O';
    if (direction.match(southeast)) return 'SO';
    if (direction.match(south)) return 'S';
    if (direction.match(southwest)) return 'SV';
    if (direction.match(west)) return 'V';
    if (direction.match(northwest)) return 'NV';
}

function parseHeight(heightPoints) {
    let alp = /^102\.6,8\.2 152\.7,93\.6 120,100 52\.4,94$/g;
    let treeline = /^29,138 52\.4,93\.6 124,100 152\.7,93 176,134 125,144$/g;
    let below =
        /^6\.5,182\.2 29,138 125,144 176,134 194\.1,173\.2 135\.6,189\.8$/g;
    if (heightPoints.match(alp)) return 'kalfjäll';
    if (heightPoints.match(treeline)) return 'trädgräns';
    if (heightPoints.match(below)) return 'under trädgränsen';
}

